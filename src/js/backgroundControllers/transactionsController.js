
export const transactionsController = (utils, actions) => {
    let nonceCache = {};
    let pendingTxStore = [];
    let nonceRetryWaitTime = 1000;
    let nonceRetryTimes = 5;
    let lastSentDate = new Date();
    let checkingTransactions = false;
    const validateTypes = utils.validateTypes

    const sendLamdenTx = (txBuilder, sentFrom = false) => {
        let network = utils.networks.getCurrent()
        lastSentDate = new Date()
        //Get current nonce from the masternode
        txBuilder.getNonce()
        .then(() => {
            //If no nonce exists in the cache for this vk then set what was recieved from the masternode as the baseline
            if (!nonceCache[txBuilder.sender]) {
                nonceCache[txBuilder.sender] = {current: txBuilder.nonce, modifier: 0}
            } else {
                //If the nonce received from the masternode is less than or equal to the nonce that we have in the cache then we need
                //to increment the nonce
                if (txBuilder.nonce <= nonceCache[txBuilder.sender].current + nonceCache[txBuilder.sender].modifier){
                    if (nonceCache[txBuilder.sender].modifier >= 14){
                        //Any vk can only have 15 pending transactions in a block
                        //if we have modified the nonce 14 times for this vk then wait to send another tx for this nonce
                        
                        if (typeof txBuilder.retry === 'undefined') txBuilder.retry = 0
                        txBuilder.retry = txBuilder.retry + 1
                        //check if already tried to resend this
                        if (txBuilder.retry > nonceRetryTimes){
                            if (sentFrom){
                                utils.sendMessageToTab(sentFrom, 'txStatus', {txData: txBuilder.getAllInfo(), errors:[
                                    'Unable to send transactions. Too many transactions pending in block.'
                                ]})
                            }
                            return
                        }else{
                            //Try and send again after waiting
                            setTimeout(() => {
                                //Resend it after waiting
                                sendLamdenTx(txBuilder, sentFrom)
                            }, nonceRetryWaitTime);
                            //Exit method
                            return
                        }
                    }else{
                        //Increment nonce
                        nonceCache[txBuilder.sender].modifier = nonceCache[txBuilder.sender].modifier + 1
                        //Set the nonce for the transaction
                        txBuilder.nonce = nonceCache[txBuilder.sender].current + nonceCache[txBuilder.sender].modifier
                    }
                }else{
                    //If the nonce we got from the masternode is greater than what is in the cache then set it as the new nonce baseline
                    nonceCache[txBuilder.sender] =  {current: txBuilder.nonce, modifier: 0}
                }
            }
            //Send transaction
            try{
                actions.signTx(txBuilder)
            }catch(e){
                console.log(e)
            }
            if (txBuilder.transactionSigned){  
                network.blockservice.getLastetBlock().then(res => {
                    txBuilder.startBlock = res;
                    txBuilder.send(undefined, (res, err) => {
                        if (err) throw new Error(err)
                        txBuilder.sentFrom = sentFrom;
                        processSendResponse(txBuilder);
                        if (sentFrom) utils.sendMessageToTab(sentFrom, 'txStatus', txBuilder.getAllInfo())
                    }) 
                });
            } 
        })
    }
    
    const sendCurrencyTransaction = (senderVk, to, amount, networkInfo) => {
        let account = actions.getAccountByVK(senderVk)
        const txInfo = {
            senderVk: account.vk,
            contractName: "currency",
            methodName: "transfer",
            kwargs: {
                "to": to,
                "amount": utils.Lamden.Encoder('float', amount)
            },
            stampLimit: 33
        }
        
        let txBuilder = new utils.Lamden.TransactionBuilder(networkInfo, txInfo)
        sendLamdenTx(txBuilder)
    }
    
    const processSendResponse = (txBuilder) => {
        const result = txBuilder.txSendResult;
        if (result.hash){
            let txData = txBuilder.getAllInfo();
            txData.sentFrom = txBuilder.sentFrom;
            txData.startBlock = txBuilder.startBlock;
            pendingTxStore.push(txData);
        }
    }
    
    const processRetry = (txData) => {
        pendingTxStore.push(txData);
    }

    const checkPendingTransactions = async () => {
        function formatResult (result) {
                let erroredTx = false;
                let errorText = `returned an error and `;
                let statusCode = validateTypes.isNumber(result.status) ? result.status : undefined;
                let stamps = result.stampsUsed || result.stamps_used || 0;
                let message = "";
                result.errors = result.errors? result.errors : result.result && result.result.includes("Error")? [result.result] : undefined;
                if (validateTypes.isArrayWithValues(result.errors)) {
                    erroredTx = true;
                    message = `This transaction returned ${result.errors.length} errors.`;
                }
                if (statusCode && erroredTx) errorText = `returned status code ${statusCode} and `;

                return {
                    title: `Transaction ${erroredTx ? "Failed" : "Successful"}`,
                    subtitle: `Your transaction ${erroredTx ? `${errorText} ` : ""}used ${stamps} stamps`,
                    message,
                    type: `${erroredTx ? "error" : "success"}`,
                    errorInfo: erroredTx ? result.errors : undefined,
                    returnResult: result.result || "",
                    stampsUsed: stamps,
                    statusCode,
                };
        }
        if (!checkingTransactions){
            checkingTransactions = true;
            const transactionsToCheck = pendingTxStore.length;
            let transactionsChecked = 0;
            for (let i = 0; i < transactionsToCheck; i++){
                const tx = pendingTxStore[i]
                const txBuilder = new utils.Lamden.TransactionBuilder(tx.networkInfo, tx.txInfo, tx)
                txBuilder.startBlock = tx.startBlock
                await txBuilder.checkBlockserviceForTransactionResult()
                .then((res) => {
                    transactionsChecked = transactionsChecked + 1
                    if (tx.sentFrom) {
                        let info = txBuilder.getAllInfo()
                        if (!res || !res.txInfo) {
                            return
                        }
                        info.resultInfo = formatResult(res.txInfo)
                        info.startBlock = tx.startBlock
                        info.sentFrom = tx.sentFrom
                        utils.sendMessageToTab(tx.sentFrom, 'txStatus', info)
                    } 
                    if (transactionsChecked >= transactionsToCheck){ 
                        pendingTxStore = pendingTxStore.slice(transactionsToCheck)
                        chrome.storage.local.set({"pendingTxs": pendingTxStore}, () => {
                            checkingTransactions = false;
                        });
                    }
                })
            }
        }
    }

    // Timer to check pending transacations
    let timerId = setTimeout(async function resolvePendingTxs() {
        if (typeof pendingTxStore.length === 'undefined'){
            pendingTxStore = []
            chrome.storage.local.set({"pendingTxs": pendingTxStore})
        } else {
            if (Object.keys(nonceCache).length > 0){
                if ((new Date().getTime() - new Date(lastSentDate).getTime() > 10000) && !checkingTransactions ){
                    nonceCache = {}
                }
            }
            if (!checkingTransactions && pendingTxStore.length > 0){
                await checkPendingTransactions()
            }
        } 
        timerId = setTimeout(resolvePendingTxs, 100);
    }, 1000);

    return {
        sendLamdenTx,
        sendCurrencyTransaction,
        processRetry
    }
}

/*
const txBatcher = (() => {
    let queue = []
    let sending = false

    document.addEventListener('lamdenWalletTxStatus', (response) => {
        // Set sending to false.
        // Any Tx result will do, failed or success, as it means the tx hit he masternode at least
        sending = false

        // deal with response
    });

    const processTxQueue = async () => {
        //Process a tx if there are items in the queue and we aren't currently sending
        if (queue.length > 0 && !sending) {
            //Call send transaction and then 
            sendTrasaction(queue[0])
        }
    }

    const sendTrasaction = async (txInfo) => {
        // Send the transaction to the wallet
        document.dispatchEvent(new CustomEvent('lamdenWalletSendTx', {details: JSON.stringify(txInfo)}));
    }

    //Check the queue every second
    setInterval(processTxQueue, 1000)

    return {
        addToQueue: (txinfo) => queue.push(txInfo)
    }
})()

txBatcher.addToQueue(txInfo)

*/