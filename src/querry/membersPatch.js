import Member from "../Models/Member.js"
import Char from "../Models/Chars.js";
import { getGuildMembers } from "../helpers/testPatchModul.js";

export async function membersPatch() {
    
    const memberList = await getGuildMembers();
    
    const dbMemberList = await Member.find({ _id, blizID });
    
}

export default membersPatch

