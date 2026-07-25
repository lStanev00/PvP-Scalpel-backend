import { Router } from "express";
import { createMediaPOST, requireAdmin } from "./route_logic/mediaCTRL/createMediaPOST.js";
import userMediaGET from "./route_logic/mediaCTRL/userMediaGET.js";
import updateMediaPATCH from "./route_logic/mediaCTRL/updateMediaPATCH.js";
import finalizeMediaPATCH from "./route_logic/mediaCTRL/finalizeMediaPATCH.js";
import acknowledgeMediaPartPATCH from "./route_logic/mediaCTRL/acknowledgeMediaPartPATCH.js";

const mediaCTRL = Router();

mediaCTRL.post("/media", requireAdmin, createMediaPOST);
mediaCTRL.patch("/media/upload-part", requireAdmin, acknowledgeMediaPartPATCH);
mediaCTRL.patch("/media", updateMediaPATCH);
mediaCTRL.patch("/media/finnalize", requireAdmin, finalizeMediaPATCH);
mediaCTRL.get("/userMedia", requireAdmin, userMediaGET);


export default mediaCTRL;
