// @ts‑check
/**
 * Check if a data is older than a hour.
*
* @param   {Object} data MongoDB Object
* @returns {Boolean} Will return FALSE if data is fresher and TRUE if data is old. 
*/

export default function isOlderThanHour (data) {
    if (!data.updatedAt) {
        throw new TypeError(`AT isOlderThanHour ---\n$-${typeof data.updatedAt} is not a valid fn call.`)
    } 
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const isOlderThanOneHour = new Date(data?.updatedAt).getTime() < oneHourAgo;

    return isOlderThanOneHour
}