/**
 * Checks if two dates fall on the same calendar day.
 * 
 * @param {Date} d1 - The first date to compare.
 * @param {Date} d2 - The second date to compare.
 * @returns {boolean} True if both dates are on the same day, otherwise false.
 */
export default function isSameDay(d1, d2) {
    return (
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate()
    );
}
