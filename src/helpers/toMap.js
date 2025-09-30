export default function toMap(incomming) {
    if (incomming instanceof Map) return incomming;
    if (Array.isArray(incomming)) {
        try {
            return result
        } catch (error) {
            return null
        }
    }
    if (Object.prototype.toString.call(incomming) === '[object Object]') {
        const result = new Map(Object.entries(incomming));
        return result
        
    }

    return new Map();
}