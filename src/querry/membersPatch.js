import Member from "../Models/Member.js"
import Char from "../Models/Chars.js";
import { getGuildMembers } from "../helpers/testPatchModul.js";

export async function membersPatch() {
    
    const memberList = await getGuildMembers();
    const dbMemberList = await Member.find({ _id, blizID });
    const dbBlizIDs = dbMemberList.filter(entry => entry.blizID);
    const mapIds = new Map(dbBlizIDs);

    const falsyIds = Array.from(memberList.filter(entry => {
        const check = mapIds.get(entry.character.id);
        return !check ? true : false;
    } ));

    
}

export default membersPatch

