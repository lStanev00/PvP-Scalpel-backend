import { ACWACache } from "../caching/achievements/accWideAchesCache.js";
import helpFetch from "../helpers/blizFetch-helpers/endpointFetchesBliz.js";
import threadBoot from "../helpers/threadBoot.js";
import AccWideAches from "../Models/AccWideAches.js";
await threadBoot();
const url =
    "https://eu.api.blizzard.com/data/wow/achievement/index?namespace=static-eu";

const data = await helpFetch.fetchBlizzard(url);

if (!data) {

    console.warn(`Account wide aches updater data from blizzard was not recived the patch will now exit`);
    process.exit(0);

}
const achBatch = [[]];
let counter = 0;
const resolvedAccWide = [];

for (const achievement of data.achievements) {
    // const achData = await helpFetch.fetchBlizzard(achievement.key.href);
    if (achBatch[counter].length < 50) {
        if (!(Array.isArray(achBatch[counter]))) achBatch[counter] = [];
        achBatch[counter].push(helpFetch.fetchBlizzard(achievement.key.href));
    } else if (achBatch[counter].length >= 50) {
        achBatch.push([]);
        achBatch[counter + 1].push(helpFetch.fetchBlizzard(achievement.key.href));
        const batch = await Promise.all(achBatch[counter]);
        for (const resolvedAch of batch) {
            if (!(resolvedAch.is_account_wide)) continue;
            resolvedAccWide.push({_id: Number(resolvedAch.id), name : resolvedAch.name, href:resolvedAch._links.self.href})
        }
        counter += 1;
    }
    // if (achData.is_account_wide) console.info(achData.name)
}

const dbBatch = resolvedAccWide.map(ach => (
    {
    updateOne: {
        filter: {
            _id: ach._id
        },
        update: {
            $set: {
                name: ach.name,
                href: ach.href,
                isAccountWide: true
            }
        },
        upsert: true
    }
}));

if (dbBatch.length) {
    const result = await AccWideAches.bulkWrite(dbBatch);
    await ACWACache.loadCache()

    // console.info({
    //     matched: result.matchedCount,
    //     modified: result.modifiedCount,
    //     inserted: result.upsertedCount
    // });
}
// console.info(resolvedAccWide.length);
// debugger
// console.log(data.achievements);
process.exit(0)