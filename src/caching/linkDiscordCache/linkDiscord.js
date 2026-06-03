import crypto from 'crypto';
import setCache from '../../helpers/redis/setterRedis.js';
import User from '../../Models/User.js';
import getCache from '../../helpers/redis/getterRedis.js';
import delCache from '../../helpers/redis/deletersRedis.js';

const keyHash = "link:discord";
const ttl = 12000;

/**
 * Generates a temporary linking hash for a Discord account ID and stores it in cache.
 *
 * @param {string} discordID - Discord snowflake ID to associate with the generated hash.
 * @returns {Promise<string|null>} The generated hexadecimal hash, or null when the Discord ID is invalid.
 */
export async function generateLinkDiscordHash(discordID) {
    if(!(isDiscordId(discordID))) {
        console.warn(discordID + " is not a valid discord id\nAT: linkDiscord.js generateLinkDiscordHash");
        return null;
    }
    
    const hex = crypto.randomBytes(16).toString('hex');

    await setCache(hex, discordID, keyHash, ttl);

    return hex;

}

/**
 * Validates a cached Discord linking hash and assigns the cached Discord ID to a user.
 *
 * @param {string} hex - Cached hexadecimal linking hash.
 * @param {string} userID - MongoDB user document ID to link with the cached Discord ID.
 * @returns {Promise<boolean|null>} True when the user is found and saved, or null when the user does not exist.
 */
export async function validateLinkDiscordHash(hex, userID) {
    const user = await User.findById(userID);
    if(!user) { // check if user exist in DBase
        console.warn(`user with ID: ${userID} , cannot be found`);
        return null;
    }

    const cachedID = await getCache(hex, keyHash);

    if(!cachedID) { // validate that there's hex in chace
        console.warn(`There's no hex: ${hex} , in the cache`);
        return null;
    }

    user.discordID = cachedID;
    await user.save();
    await delCache(hex, keyHash);

    return true;

}

/**
 * Retrieves a user document by linked Discord account ID.
 *
 * @param {string} discordID - Discord snowflake ID stored on the user document.
 * @returns {Promise<import('../../Models/User.js').default|null>} The matching user document, or null when invalid or not found.
 */
export async function retriveUserByDiscordID(discordID) {

    if(!(isDiscordId(discordID))) {
        console.warn(discordID + " is not a valid discord id\nAT: linkDiscord.js retriveUserByDiscordID");
        return null;
    }

    const user = await User.findOne({ discordID: discordID });

    if(!user) {
        console.warn(discordID + "there's no user with this discordID");
        return null
    }

    return user;
    

}

/**
 * Checks whether a value matches the expected Discord snowflake ID format.
 *
 * @param {unknown} value - Value to validate.
 * @returns {boolean} True when the value is a 17-20 digit string.
 */
function isDiscordId(value) {
    return typeof value === 'string' && /^\d{17,20}$/.test(value);
}
