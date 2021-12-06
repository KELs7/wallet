import faunadb from 'faunadb';

const faunadbClient = new faunadb.Client({
    secret: 'fnAEZdV4I8AARa49Wpu_8Jmy5endniTFdYT7yBoF',
    domain: 'db.us.fauna.com',
    port: 443,
    scheme: 'https'
})
const q = faunadb.query;

const fetchUpdates = async () => {
    try {
        const res = await faunadbClient.query( 
            q.Map(
              q.Paginate(
                q.Documents(q.Collection('updates')),
                {size: 10}
              ), 
              q.Lambda(ref => q.Let({
                originDoc: q.Get(ref)
              },
              q.Merge(q.Select('data', q.Var('originDoc')),{
                date_added: q.ToMillis(q.Select(['data','date_added'], q.Var('originDoc'))),
                id: q.Select('ts', q.Var('originDoc'))
              })
              ))
            )
          )
        const updates = [];

        if (res && res.data) {
            res.data.map(x => {
                updates.push(x)
            });
            chrome.storage.local.set({"events": updates});
            console.log("Fetch updates success!");
        }
    } catch(e) {
        console.error(e);
    }
}

export default {
  fetchUpdates
}