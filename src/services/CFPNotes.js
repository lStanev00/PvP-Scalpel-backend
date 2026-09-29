import { randomUUID } from "node:crypto";
import threadBoot from "../helpers/threadBoot.js";
import Service from "../Models/Services.js";
import CFPNotesPost from "../Models/CFPNotesPost.js";
import { getNewBluePosts } from "./Service-Helpers/CFPNotes/getLatesPNotes.js";
import getPostContent, { PostNotStaffError } from "./Service-Helpers/CFPNotes/getPostContent.js";
import { judgeBluePost } from "./Service-Helpers/CFPNotes/judgeBluePost.js";
import { preparePNotesPayload } from "./Service-Helpers/CFPNotes/publishPNotes.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function scan(serviceDoc) {
    const { posts, newestId } = await getNewBluePosts({
        cursor: serviceDoc.scanCursor,
        since: serviceDoc.scanCursor ? null : new Date(Date.now() - DAY_MS),
    });
    const legacyPublished = new Set((serviceDoc.data ?? []).map(String));
    for (const post of posts) {
        if (legacyPublished.has(String(post.id))) continue;
        await CFPNotesPost.updateOne(
            { postId: String(post.id) },
            { $setOnInsert: {
                postId: String(post.id), title: post.title, url: post.url,
                postedAt: new Date(post.createdAt), status: "pending",
            } },
            { upsert: true },
        );
    }
    if (newestId && (!serviceDoc.scanCursor || Number(newestId) > Number(serviceDoc.scanCursor))) {
        serviceDoc.scanCursor = newestId;
        await serviceDoc.save();
    }
}

async function processCandidates() {
    const pending = await CFPNotesPost.find({ status: "pending" }).sort({ postedAt: 1 });
    for (const candidate of pending) {
        try {
            const post = await getPostContent({ id: Number(candidate.postId), title: candidate.title, url: candidate.url });
            const result = await judgeBluePost(post);
            await CFPNotesPost.updateOne(
                { _id: candidate.id, status: "pending" },
                { $set: { status: result.status, scores: result.scores, lastError: null } },
            );
        } catch (error) {
            if (error instanceof PostNotStaffError) {
                await CFPNotesPost.updateOne({ _id: candidate.id }, { $set: { status: "dismissed", lastError: null } });
                continue;
            }
            await CFPNotesPost.updateOne({ _id: candidate.id }, { $set: { lastError: String(error) } });
            console.error(`[CFPNotes] Could not judge post ${candidate.postId}:`, error);
        }
    }

    const approved = await CFPNotesPost.find({ status: "approved" }).sort({ postedAt: 1 });
    for (const candidate of approved) {
        try {
            const post = await getPostContent({ id: Number(candidate.postId), title: candidate.title, url: candidate.url });
            const payload = await preparePNotesPayload(post);
            await CFPNotesPost.updateOne(
                { _id: candidate.id, status: "approved" },
                { $set: { status: "ready", payload, lastError: null } },
            );
        } catch (error) {
            await CFPNotesPost.updateOne({ _id: candidate.id }, { $set: { lastError: String(error) } });
            console.error(`[CFPNotes] Could not prepare post ${candidate.postId}:`, error);
        }
    }
}

async function checkForPNotes() {
    const token = randomUUID();
    const lockUntil = () => new Date(Date.now() + 10 * 60 * 1000);
    const serviceDoc = await Service.findOneAndUpdate(
        { service: "CFPNotes", $or: [
            { scanLockUntil: null }, { scanLockUntil: { $lte: new Date() } },
        ] },
        { $set: { running: true, scanLockToken: token, scanLockUntil: lockUntil() } },
        { new: true },
    );
    if (!serviceDoc) {
        if (!await Service.exists({ service: "CFPNotes" })) {
            throw new Error("[CFPNotes] Service record not found.");
        }
        return;
    }
    const heartbeat = setInterval(() => {
        Service.updateOne(
            { _id: serviceDoc.id, scanLockToken: token },
            { $set: { scanLockUntil: lockUntil() } },
        ).catch(error => console.error("[CFPNotes] Lock renewal failed:", error));
    }, 60_000);
    try {
        await scan(serviceDoc);
        await processCandidates();
    } finally {
        clearInterval(heartbeat);
        await Service.updateOne(
            { _id: serviceDoc.id, scanLockToken: token },
            { $set: { running: false }, $unset: { scanLockToken: "", scanLockUntil: "" } },
        );
    }
}

let exitCode = 0;
try {
    await threadBoot(true);
    await checkForPNotes();
} catch (error) {
    console.error(error);
    exitCode = 1;
}
process.exit(exitCode);
