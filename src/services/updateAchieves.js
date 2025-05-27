import dotenv from 'dotenv';
import helpFetch from '../helpers/blizFetch-helpers/endpointFetchesBliz.js';
import Achievement from '../Models/Achievements.js';

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

            if (achievements) {
                for (const achievement of achievements) {

                    const exist = await Achievement.findById(achievement.id);

                    if (exist) {

                        if (exist.name != achievement?.name || exist.href != achievement?.key?.href) {
    
                            exist.name = achievement?.name;;
                            exist.href = achievement?.key?.href;
                            
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
        }
        
    } catch (error) {
        console.warn(error)
        
    }

}