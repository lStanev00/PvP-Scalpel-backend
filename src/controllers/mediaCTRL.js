import { Router } from "express";
import { createMediaPOST, requireAdmin } from "./route_logic/mediaCTRL/createMediaPOST.js";
import userMediaGET from "./route_logic/mediaCTRL/userMediaGET.js";
import updateMediaPATCH from "./route_logic/mediaCTRL/updateMediaPATCH.js";
import finalizeMediaPATCH from "./route_logic/mediaCTRL/finalizeMediaPATCH.js";

const mediaCTRL = Router();

mediaCTRL.post("/media", requireAdmin, createMediaPOST);
mediaCTRL.patch("/media", updateMediaPATCH);
mediaCTRL.patch("/media/finnalize", finalizeMediaPATCH);
mediaCTRL.get("/userMedia", requireAdmin, userMediaGET);


export default mediaCTRL;