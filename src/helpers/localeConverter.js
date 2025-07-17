export default function convertLocale(plainLocale) {
    const fixed = plainLocale.replace(/^([a-z]{2})([A-Z]{2})$/, "$1_$2"); 
    return fixed
}