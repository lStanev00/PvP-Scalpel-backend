import initialCache from "../../caching/initialCache.js";
import threadBoot from "../../helpers/threadBoot.js";
import GameBrackets from "../../Models/GameBrackets.js";

await threadBoot(true)

const brackets = await GameBrackets.find({isRated: true}, {slug: 0});

if(brackets.length !== 0) {
    for (const bracket of brackets) {
        const name = bracket.name.toLowerCase();
        let slug = "";
        if(name.includes("blitz")) {
            slug= "blitz"
        } else if (name.includes("shuffle")) {
            slug = "shuffle"
        } else if (name.includes("2v2")) {
            slug = "2v2"
        } else if (name.includes("3v3")) {
            slug = "3v3"
        } else if (name.includes("rated battle") && bracket.isSolo === false) {
            slug =  "rbg"
        } else {
            slug = name.trim().replaceAll(" ", "-")
        }
        console.info(`Setting slug: ${slug}, for bracket: ${name}`);
        await bracket.set({
            slug : slug
        }).save()
    }
}

const success = await initialCache();


process.exit(success ? 0 : 1);