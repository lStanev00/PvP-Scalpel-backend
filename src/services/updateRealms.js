import helpFetch from '../helpers/blizFetch-helpers/endpointFetchesBliz.js';
import { delay } from '../helpers/startBGTask.js';
import { getRealmIdsMap, setRealmIdsMap } from '../caching/realms/realmCache.js';
import { getRegionIdsMap, setRegionIdsMap } from '../caching/regions/regionCache.js';
import Realm from '../Models/Realms.js';
import { getRealmSearchMap, insertOneRealmSearchMap } from '../caching/searchCache/realmSearchCach.js';


export default async function updateDBRealms() {
    
    let storedRegions = getRegionIdsMap();

    if(storedRegions === null) {
        await setRegionIdsMap();
        await delay(2000);
        storedRegions = getRegionIdsMap();
    }
    
    while (true) {

        if (!(storedRegions instanceof Map)) {
            await setRegionIdsMap();
            await delay(2000);
            storedRegions = getRegionIdsMap();
        } else {
            break;
        }
        
    }

    let storedRealms = getRealmIdsMap();
    let storedRealmSearech = getRealmSearchMap();

    if(storedRealms === null) {
        await setRealmIdsMap();
        await delay(2000);
        storedRealms = getRealmIdsMap();
    }
    
    while (true) {

        if (!(storedRealms instanceof Map)) {
            await setRealmIdsMap();
            await delay(2000);
            storedRealms = getRealmIdsMap();
        } else {
            break;
        }
        
    }
    
    for (const [key, value] of storedRegions) {

        const regionSlug = value?.slug;

        if (typeof regionSlug !== "string") {

            console.warn(regionSlug + "\nIs not a string");
            continue;

        }

        if (regionSlug === "cn" || regionSlug === "CN") continue;

        const realmsExtractUrl = `https://${regionSlug}.api.blizzard.com/data/wow/search/connected-realm?namespace=dynamic-${regionSlug}&orderby=id`;

        try {
            const req = await helpFetch.fetchBlizzard(realmsExtractUrl);

            if(req.ok) {
                const blizData = await req.json();
                
                if (blizData.results && Array.isArray(blizData?.results)) {
                    for (const { data } of blizData.results) {

                        if(data) {
                            
                            const {realms} = data;
                            if(Array.isArray(realms)){
                                for (const realm of realms) {
                                    const {timezone, name, region, id, slug} = realm;
                                    const idString = String( slug + ":" + region.id);
                                    const exist = storedRealms.has(idString);
                                    const searchExist = storedRealmSearech.has(slug);

                                    if(exist) {
                                        if(searchExist){
                                            continue
                                        } else {
                                            const relamSearchToBeInserted = storedRealms.get(idString);
                                            await insertOneRealmSearchMap(relamSearchToBeInserted);
                                        }
                                    }
                                    else {
                                        const newRealm = new Realm();
                                        newRealm._id = id;
                                        newRealm.name = name["en_GB"];
                                        newRealm.slug = slug;
                                        newRealm.timezone = timezone;
                                        newRealm.region = region?.id;
                                        const newRealmRecived = await newRealm.save();
                                        if(newRealmRecived) {
                                            await insertOneRealmSearchMap(newRealmRecived);
                                        }
                                    }
                                }
                            }
                                
                        }
                        

                    }
                }

            }
        } catch (error) {
            console.warn(error)
        }
        
    }
    await setRealmIdsMap();

}