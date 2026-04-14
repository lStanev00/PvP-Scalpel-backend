export default function getRatingEntries(rating) {
    if (!rating) return [];
    if (rating instanceof Map) return [...rating.entries()];
    return Object.entries(rating);
}
