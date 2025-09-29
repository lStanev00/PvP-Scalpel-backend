import { sanitizeValue } from "../../middlewares/sanitizer";

// Validate Key
export default function checkKey(key) {

    if(!key) throw new Error("You must provide a key");
        
    if(key instanceof Types.ObjectId || typeof key === "number") key = key.toString();

    if (key.length > 24) throw new Error("The key character length's too long\n Must be within 24 characters");

    if (typeof key !== "string") throw new TypeError(`The type of: ${sanitizeValue(key)} is not a valid type!`);

    return key;

}