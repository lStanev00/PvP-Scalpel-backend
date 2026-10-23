import dotenv from 'dotenv';
import helpFetch from '../helpers/blizFetch-helpers/endpointFetchesBliz.js';
import Achievement from '../Models/Achievements.js';
import { getSeasonalIdsMap, setSeasonalIdsMap } from '../caching/achievements/achievesEmt.js';
import { delay } from '../helpers/startBGTask.js';
import threadBoot from '../helpers/threadBoot.js';

export default async function updateDBAchieves() {
    
    // const feastOfStrengthURL = `https://eu.api.blizzard.com/data/wow/achievement-category/15270?namespace=static-11.1.5_60179-eu`; !!OLD SEASON WWI SSN2
    const feastOfStrengthURL = `https://eu.api.blizzard.com/data/wow/achievement-category/15270?namespace=static-eu`; //!! WWI SSN3
    
    try {
        const data = await helpFetch.fetchBlizzard(feastOfStrengthURL);

        const achievements = data?.achievements;
        let storedAches = await getSeasonalIdsMap();

        if(storedAches === null || storedAches.size === 0) {
            await setSeasonalIdsMap()
            await delay(2000);
            storedAches = await getSeasonalIdsMap();
        }

        if (achievements) {
            for (const achievement of achievements) {
                const stringId = String(achievement.id);
                // let exist = storedAches.get(stringId)?._id
                let exist = storedAches.get(stringId);

                if (exist) {
                    // exist = JSON.parse(exist);
                    exist = exist = await Achievement.findById(exist._id) || undefined;
                    if (exist.name != achievement?.name || exist.href != achievement?.key?.href || exist.media === undefined || exist.__v === 0) {
                            
                        exist.name = achievement?.name;;
                        exist.href = achievement?.key?.href;
                            
                        const achData = await helpFetch.fetchBlizzard(achievement.key.href);
                        const mediaString = await helpFetch.getMedia(achData, "media");
                            
                        if(mediaString) exist.media = mediaString;
                        if(achData.description) exist.description = achData.description;
                        if(achData.display_order) exist.displayOrder = achData.display_order;
                        if(achData.category) exist.category = achData.category.id;
                        if(achData.criteria) exist.criteria = achData.criteria.id;
                        if(achData.is_account_wide) exist.isAccWide = true;
                        exist.__v = 1;

                        const name = achData?.name;

                        if(name && name.includes(`: `) && name.includes(` Season `)) {
                            try {
                                const [ title, expansion ] = name.split(`: `);
                                // let expName;
                                // let seasonIndex;
                                const [ expName, seasonIndex ] = expansion.split(` Season `);

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
    
                    const achData = await helpFetch.fetchBlizzard(achievement.key.href);
                    const mediaString = await helpFetch.getMedia(achData, "media");

                    if(mediaString) newAch.media = mediaString;
                    if(achData.description) newAch.description = achData.description;
                    if(achData.display_order) newAch.displayOrder = achData.display_order;
                    if(achData.category) newAch.category = achData.category.id;
                    if(achData.criteria) newAch.criteria = achData.criteria.id;
                    if(achData.is_account_wide) newAch.isAccWide = true;
                    newAch.__v = 1;

                    const name = achData?.name;

                    if(name && name.includes(`: `) && name.includes(` Season `)) {
                        try {
                            const [ title, expansion ] = name.split(`: `);
                            const [ expName, seasonIndex ] = expansion.split(` Season `);

                            if(seasonIndex) {
                                const season = Number(seasonIndex);
                                newAch.expansion.name = expName;
                                newAch.expansion.season = season;
                            } else {
                                const season = Number(expName.replace(`Season `, ""));
                                newAch.expansion.season = season;
                            }

                        } catch (error) {
                            console.warn(error)
                        }

                    }
                    await newAch.save();

                }

            }
        }
        await delay(2000);
        await setSeasonalIdsMap()
        
    } catch (error) {
        console.warn(error)
        return false
    }

    return true

}
await threadBoot(false); await updateDBAchieves()