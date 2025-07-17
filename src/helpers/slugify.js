export default function slugify (plainText) {
    if (typeof plainText !== "string") throw new TypeError(`The input is of type ${typeof plainText}, while it's expected to be a string`);

    const output = (plainText.toLowerCase()).trim().replaceAll(` `, "-");
    return output
}