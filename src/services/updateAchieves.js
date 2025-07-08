import dotenv from 'dotenv';
import helpFetch from '../helpers/blizFetch-helpers/endpointFetchesBliz.js';
import Achievement from '../Models/Achievements.js';
import { getSeasonalIdsMap, setSeasonalIdsMap } from '../caching/achievements/achievesEmt.js';
import { delay } from '../helpers/startBGTask.js';

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;

const buildHeaders = async () => {
    let accessToken = await helpFetch.getAccessToken(clientId, clientSecret);

    const headers = {
        headers: {
          Authorization: `Bearer ${accessToken}`, 
          'Cache-Control': 'no-cache',  
          'Pragma': 'no-cache',
        },
    }

    return headers

}

export default async function updateDBAchieves() {
    const headers = await buildHeaders();
    
    
    const feastOfStrengthURL = `https://eu.api.blizzard.com/data/wow/achievement-category/15270?namespace=static-11.1.5_60179-eu`;
    
    try {
        const req = await helpFetch.fetchWithLocale(feastOfStrengthURL, headers);

        if (req.status == 200){
            const data = await req.json();
            const achievements = data?.achievements;
            let storedAches = getSeasonalIdsMap();
            if(storedAches === null) {
                await setSeasonalIdsMap()
                await delay(2000);
                storedAches = getSeasonalIdsMap();
            }

            if (achievements) {
                for (const achievement of achievements) {
                    const stringId = String(achievement.id);
                    const exist = storedAches.get(stringId);

                    if (exist) {

                        if (exist.name != achievement?.name || exist.href != achievement?.key?.href) {
    
                            exist.name = achievement?.name;;
                            exist.href = achievement?.key?.href;

                            
                            const achDataReq = await helpFetch.fetchWithLocale(achievement.key.href, headers);

                            const achData = await achDataReq.json();

                            const mediaString = await helpFetch.getMedia(achData, "media", headers);
                            
                            if(mediaString) exist.media = mediaString;
                            if(achData.description) exist.description = achData.description;
                            if(achData.display_order) exist.displayOrder = achData.display_order;
                            if(achData.category) exist.category = achData.category.id;
                            if(achData.criteria) exist.criteria = achData.criteria.id;

                            let name = achData?.name;

                            if(name && name.includes(`: `) && name.includes(` Season `)) {

                                try {

                                    const [ title, expansion ] = name.split(`: `);

                                    let expName;
                                    let seasonIndex;
                                    [ expName, seasonIndex ] = expansion.split(` Season `);

                                    if(seasonIndex) {
                                        const season = Number(seasonIndex);
        
                                        exist.expansion.name = expName;
                                        exist.expansion.season = season;

                                    } else {
                                        seasonIndex = expName.replace(`Season `, "");
                                        const season = Number(seasonIndex);
                                        exist.expansion.season = season;
                                    }

                                    
                                } catch (error) {

                                    console.warn(error)
                                    
                                }

                            }

                            await exist.save();
                        }
                        
                        continue;

                    }

                    if(achievement.id && achievement.name && achievement.key.href) {

                        const newAch = new Achievement({
                            _id: achievement.id,
                            name: achievement.name,
                            href: achievement.key.href
                        })
    
                        await newAch.save();

                    }

                }
            }
            await delay(2000);
            await setSeasonalIdsMap()
        }
        
    } catch (error) {
        console.warn(error)
        
    }

}