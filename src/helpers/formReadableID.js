/**
 * This function takes a buffer and return it as a string 
 * this buffer can be MongoDB _id or any other buffer alike
 * the function is advanced and converts jsons then string translates them. 
 * @param {Buffer} [id] - Provide a Buffer to convert to a readable String
 * @returns {String}
 */
export default function formReadableID(id) {
    if (id == null) return undefined;
    try {
        return typeof id === 'object' && id.buffer
            ? Buffer.from(Object.values(id.buffer)).toString('utf8')
            : id.toString();
    } catch (err) {
        console.warn(`FUNCTION ERROR! --\nAt@formReadableId --\n${err}`);
        return undefined;
    }
}
