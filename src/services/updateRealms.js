import helpFetch from '../helpers/blizFetch-helpers/endpointFetchesBliz.js';
import { delay } from '../helpers/startBGTask.js';
import { getRealmIdsMap, setRealmIdsMap } from '../caching/realms/realmCache.js';
import { getRegionIdsMap, setRegionIdsMap } from '../caching/regions/regionCache.js';
import Realm from '../Models/Realms.js';
import { getRealmSearchMap, insertOneRealmSearchMap } from '../caching/searchCache/realmSearchCach.js';
import convertLocale from '../helpers/localeConverter.js';


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
        // const realmsExtractUrl = `https://eu.api.blizzard.com/data/wow/search/connected-realm?namespace=dynamic-eu&orderby=id`;

        try {
            const blizData = await helpFetch.fetchBlizzard(realmsExtractUrl);
                
            if (blizData.results && Array.isArray(blizData?.results)) {
                for (const { data } of blizData.results) {

                    if(data) {
                            
                        const {realms} = data;
                        if(Array.isArray(realms)){
                            for (const realm of realms) {
                                const {timezone, name, region, id, slug} = realm;
                                const locale = realm?.["locale"]
                                    
                                const zone = convertLocale(locale);

                                const idString = String( slug + ":" + region.id);
                                const exist = storedRealms.has(idString);
                                const searchExist = storedRealmSearech.has(slug);

                                if(exist) {
                                    if(searchExist){
                                        continue
                                    } else {
                                        const realmSearchToBeInserted = storedRealms.get(idString);
                                        await insertOneRealmSearchMap(realmSearchToBeInserted);
                                    }
                                }
                                else {
                                    const newRealm = new Realm();
                                    newRealm._id = id;
                                    newRealm.name = name;
                                    newRealm.locale = zone;
                                    newRealm.slug = slug;
                                    newRealm.timezone = timezone;
                                    newRealm.region = region?.id;
                                    const newRealmRecived = await newRealm.save();
                                    if(newRealmRecived) {
                                        await insertOneRealmSearchMap(newRealmRecived.toObject());
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