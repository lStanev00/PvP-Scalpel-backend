import crypto from "crypto";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import { RESTFetch } from "../../../helpers/RESTFetch.js";
import setCache from "../../../helpers/redis/setterRedis.js";
import getCache from "../../../helpers/redis/getterRedis.js";
import delCache from "../../../helpers/redis/deletersRedis.js";
import { extRetChar } from "../../../helpers/blizFetch-helpers/extRetChar.js";

const baseFEUrl = "https://www.pvpscalpel.com";
const joinDraftTTLSeconds = 30 * 60;
const redisHashKey = "zugee:join";
const twinkCheckboxCustomId = "join_selected_twinks";
const maxTwinkCheckboxes = 10;

const editFlags = MessageFlags.SuppressEmbeds;

async function editReplyNoEmbeds(interaction, payload) {
    const message = await interaction.editReply({
        ...payload,
        flags: editFlags,
    });

    if (message?.suppressEmbeds) {
        await message.suppressEmbeds(true).catch(() => {});
    }

    return message;
}

async function createJoinDraft(mainCharacterString) {
    const key = crypto.randomUUID();

    const draft = {
        id: key,
        characters: [mainCharacterString],
        createdAt: Date.now(),
    };

    await setCache(key, draft, redisHashKey, joinDraftTTLSeconds);

    return key;
}

function slugifyRealm(realm) {
    return String(realm || "")
        .trim()
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function getBestTwinkRating(twink) {
    return Math.max(
        Number(twink?.rateatm2v2 || 0),
        Number(twink?.rateatm3v3 || 0),
        Number(twink?.rateatmrbg || 0),
        Number(twink?.rateatmshuffle || 0),
        Number(twink?.rateatmbgb || 0),
        Number(twink?.rateatmbiltz || 0),
        Number(twink?.ratemax2v2 || 0),
        Number(twink?.ratemax3v3 || 0),
        Number(twink?.ratemaxrbg || 0),
        Number(twink?.ratemaxshuffle || 0),
        Number(twink?.ratemaxbgb || 0),
        Number(twink?.ratemaxblitz || 0),
        Number(twink?.hfrbg || 0),
        0,
    );
}

function normalizeTwinkString(twink) {
    return [twink?.name, slugifyRealm(twink?.realm), String(twink?.region || "eu").toLowerCase()]
        .filter(Boolean)
        .join(":");
}

function makeTwinkLabel(twink) {
    return [twink?.name, twink?.realm, String(twink?.region || "eu").toUpperCase()]
        .filter(Boolean)
        .join(" - ");
}

function makeTwinkDescription(twink) {
    const rating = getBestTwinkRating(twink);

    return [
        twink?.level ? `Level ${twink.level}` : null,
        rating > 0 ? `Best ${rating}` : "No visible rating",
    ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 100);
}

function buildTwinkOptions(twinks, draft) {
    const existing = new Set(draft.characters || []);
    const seen = new Set();
    const options = [];
    // console.info(twinks)
    twinks = twinks.filter((entry) => entry?.level > 85)

    for (const twink of twinks || []) {
        const value = normalizeTwinkString(twink);

        if (!value) continue;
        if (existing.has(value)) continue;
        if (seen.has(value)) continue;

        seen.add(value);
        const entry = await charRetrieve([twink?.name, twink?.realm.toLowerCase().replaceAll(" ", "-"), twink?.region])
        options.push({
            label: makeTwinkLabel(twink).slice(0, 100),
            value: value.slice(0, 100),
            description: makeTwinkDescription(twink),
            default: false,
        });

        if (options.length === maxTwinkCheckboxes) break;
    }

    return options;
}

function mergePendingTwinks(draft, nextTwinks) {
    const existingCharacters = new Set(draft.characters || []);
    const seen = new Set();
    const merged = [];

    for (const option of [...(draft.pendingTwinks || []), ...(nextTwinks || [])]) {
        if (!option?.value) continue;
        if (existingCharacters.has(option.value)) continue;
        if (seen.has(option.value)) continue;

        seen.add(option.value);
        merged.push(option);

        if (merged.length === maxTwinkCheckboxes) break;
    }

    draft.pendingTwinks = merged;
    return draft;
}

function hasPendingTwinks(draft) {
    return Array.isArray(draft?.pendingTwinks) && draft.pendingTwinks.length > 0;
}

async function saveJoinDraft(draft) {
    const key = draft.id;

    await setCache(key, draft, redisHashKey, joinDraftTTLSeconds);
    return true;
}

function normalizeCharacterString(character) {
    return [
        character?.name,
        character?.playerRealm?.slug || character?.realmSlug,
        character?.server,
    ]
        .filter(Boolean)
        .join(":");
}

function makeCharacterLabel(character) {
    return [
        character?.name,
        character?.playerRealm?.name || character?.realmName || character?.realmSlug,
        character?.server?.toUpperCase(),
    ]
        .filter(Boolean)
        .join(" - ");
}

function parseCharacterInput(searchString) {
    let server;
    let realm;
    let name;

    const regex = /\/check\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)/;
    const match = searchString.match(regex);

    if (match) {
        server = decodeURIComponent(match[1]).toLowerCase();
        realm = decodeURIComponent(match[2]).toLowerCase();
        name = decodeURIComponent(match[3]);
    } else {
        const parts = searchString.split(":");

        name = parts[0];
        realm = parts[1];
        server = parts[2]?.toLowerCase();
    }

    return {
        server,
        realm,
        name,
    };
}

async function charRetrieve(searchString) {
    const { server, realm, name } = parseCharacterInput(searchString);

    if (!server || !realm || !name) {
        return {
            status: 400,
            data: null,
            url: null,
        };
    }

    const res = await RESTFetch(
        `/checkCharacter/${encodeURIComponent(server)}/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`,
    );

    return {
        status: res.status,
        data: res.data,
        url: `${baseFEUrl}/check/${encodeURIComponent(server)}/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`,
    };
}

function buildJoinButtons(draftId, options = {}) {
    const components = [
        new ButtonBuilder()
            .setCustomId(`join_confirm:${draftId}`)
            .setLabel("Confirm Join")
            .setStyle(ButtonStyle.Success),
    ];

    if (options.hasPendingTwinks) {
        components.push(
            new ButtonBuilder()
                .setCustomId(`join_pick_twinks:${draftId}`)
                .setLabel("Pick detected alts")
                .setStyle(ButtonStyle.Primary),
        );
    }

    components.push(
        new ButtonBuilder()
            .setCustomId(`join_add_alt:${draftId}`)
            .setLabel("Add alt/s")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId(`join_cancel:${draftId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
    );

    return new ActionRowBuilder().addComponents(...components);
}

function buildTwinkCheckboxModal(draft) {
    const options = (draft.pendingTwinks || []).slice(0, maxTwinkCheckboxes);

    const checkboxGroup = {
        type: ComponentType.CheckboxGroup,
        custom_id: twinkCheckboxCustomId,
        min_values: 0,
        max_values: options.length,
        required: false,
        options,
    };

    const label = new LabelBuilder({
        label: "Detected alts",
        description: "Select the alts you want to include in this join request.",
        component: checkboxGroup,
    });

    return new ModalBuilder()
        .setCustomId(`join_twinks_modal:${draft.id}`)
        .setTitle("Select PvP Scalpel Alts")
        .addLabelComponents(label);
}

function getCheckboxGroupValues(interaction, customId) {
    if (typeof interaction.fields.getCheckboxGroup === "function") {
        return [...interaction.fields.getCheckboxGroup(customId)];
    }

    const raw = interaction.fields.fields?.get(customId);
    return raw?.values || [];
}

async function buildJoinPreviewContent(draft) {
    const content = ["## PvP Scalpel Join (Preview)", ""];

    const characters = [];

    for (const charString of draft.characters) {
        const character = await charRetrieve(charString);

        if (character.status === 200 && character.data) {
            characters.push(character);
        }
    }

    if (characters.length === 0) {
        return ["## PvP Scalpel Join", "", "No valid characters found in this join draft."].join(
            "\n",
        );
    }

    const main = characters[0];

    content.push(`Main character: [${makeCharacterLabel(main.data)}](${main.url})`);

    for (let i = 1; i < characters.length; i += 1) {
        const alt = characters[i];

        content.push(`Alt #${i}: [${makeCharacterLabel(alt.data)}](${alt.url})`);
    }

    if (hasPendingTwinks(draft)) {
        content.push("");
        content.push(
            `Detected ${draft.pendingTwinks.length} possible alt/s. Use \`Pick detected alts\` to select them.`,
        );
    }

    content.push("");
    content.push("Confirm if this is the correct character or add more alts to join with.");

    return content.join("\n");
}

async function buildAppliedContent(draft) {
    const content = ["## Applied", ""];

    const characters = [];

    for (const charString of draft.characters) {
        const character = await charRetrieve(charString);

        if (character.status === 200 && character.data) {
            characters.push(character);
        }
    }

    if (characters.length === 0) {
        return ["## Failed", "", "No valid characters found."].join("\n");
    }

    const main = characters[0];

    content.push(`Main character: [${makeCharacterLabel(main.data)}](${main.url})`);

    for (let i = 1; i < characters.length; i += 1) {
        const alt = characters[i];

        content.push(`Alt #${i}: [${makeCharacterLabel(alt.data)}](${alt.url})`);
    }

    content.push("");
    content.push("State updated: `sent for review`");

    return content.join("\n");
}

export async function joinAutocompleteHandler(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const res = await RESTFetch("/checkCharacter/getLatest25");

    if (res.status !== 200 || !Array.isArray(res.data)) {
        await interaction.respond([]);
        return true;
    }

    const choices = [];

    for (const character of res.data) {
        const label = makeCharacterLabel(character);
        const value = normalizeCharacterString(character);

        if (!value) continue;

        if (!focused || label.toLowerCase().includes(focused)) {
            choices.push({
                name: label.slice(0, 100),
                value: value.slice(0, 100),
            });
        }

        if (choices.length === 25) break;
    }

    await interaction.respond(choices);
    return true;
}

export async function joinButtonHandler(interaction) {
    if (interaction.customId.startsWith("join_confirm:")) {
        await interaction.deferUpdate();

        const draftId = interaction.customId.slice("join_confirm:".length);
        const draft = await getCache(draftId, redisHashKey);

        if (!draft) {
            await interaction.editReply({
                content: ["## Join draft expired", "", "Please start the join flow again."].join(
                    "\n",
                ),
                components: [],
            });

            return true;
        }

        const content = await buildAppliedContent(draft);

        await delCache(draftId, redisHashKey);

        await interaction.editReply({
            content,
            components: [],
        });

        return true;
    }

    if (interaction.customId.startsWith("join_pick_twinks:")) {
        const draftId = interaction.customId.slice("join_pick_twinks:".length);
        const draft = await getCache(draftId, redisHashKey);

        if (!draft) {
            await interaction.reply({
                content: ["## Join draft expired", "", "Please start the join flow again."].join(
                    "\n",
                ),
                flags: MessageFlags.Ephemeral,
            });

            return true;
        }

        if (!hasPendingTwinks(draft)) {
            await interaction.reply({
                content: [
                    "## No detected alts",
                    "",
                    "There are no detected alts available for this draft.",
                ].join("\n"),
                flags: MessageFlags.Ephemeral,
            });

            return true;
        }

        await interaction.showModal(buildTwinkCheckboxModal(draft));
        return true;
    }

    if (interaction.customId.startsWith("join_add_alt:")) {
        const draftId = interaction.customId.slice("join_add_alt:".length);

        const modal = new ModalBuilder()
            .setCustomId(`join_alt_modal:${draftId}`)
            .setTitle("Add PvP Scalpel Alt");

        const input = new TextInputBuilder()
            .setCustomId("character")
            .setLabel("Character URL or Name:realm:region")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Lychezar:chamber-of-aspects:eu")
            .setRequired(true)
            .setMaxLength(100);

        const row = new ActionRowBuilder().addComponents(input);

        modal.addComponents(row);

        await interaction.showModal(modal);
        return true;
    }

    if (interaction.customId.startsWith("join_cancel:")) {
        const draftId = interaction.customId.slice("join_cancel:".length);

        await delCache(draftId, redisHashKey);

        await interaction.update({
            content: ["## Cancelled", "State updated: `cancelled`"].join("\n"),
            components: [],
        });

        return true;
    }

    return false;
}

export async function joinModalHandler(interaction) {
    if (interaction.customId.startsWith("join_twinks_modal:")) {
        await interaction.deferUpdate();

        const draftId = interaction.customId.slice("join_twinks_modal:".length);
        const selectedTwinks = getCheckboxGroupValues(interaction, twinkCheckboxCustomId);
        const draft = await getCache(draftId, redisHashKey);

        if (!draft) {
            await interaction.editReply({
                content: [
                    "## Join draft expired",
                    "",
                    "Please start the join flow again.",
                ].join("\n"),
                components: [],
            });

            return true;
        }

        const allowedTwinks = new Set(
            (draft.pendingTwinks || []).map((twink) => twink.value)
        );

        for (const charString of selectedTwinks) {
            if (!allowedTwinks.has(charString)) continue;

            if (!draft.characters.includes(charString)) {
                draft.characters.push(charString);
            }
        }

        draft.pendingTwinks = (draft.pendingTwinks || []).filter((twink) => {
            return !draft.characters.includes(twink.value);
        });

        await saveJoinDraft(draft);

        await editReplyNoEmbeds(interaction, {
            content: await buildJoinPreviewContent(draft),
            components: [
                buildJoinButtons(draftId, {
                    hasPendingTwinks: hasPendingTwinks(draft),
                }),
            ],
        });

        return true;
    }

    if (!interaction.customId.startsWith("join_alt_modal:")) {
        return false;
    }

    await interaction.deferUpdate();

    const draftId = interaction.customId.slice("join_alt_modal:".length);
    const input = interaction.fields.getTextInputValue("character").trim();
    const draft = await getCache(draftId, redisHashKey);

    if (!draft) {
        await interaction.editReply({
            content: [
                "## Join draft expired",
                "",
                "Please start the join flow again.",
            ].join("\n"),
            components: [],
        });

        return true;
    }

    const character = await charRetrieve(input);

    if (character.status !== 200 || !character.data) {
        await interaction.editReply({
            content: [
                "## Alt not found",
                "",
                `Input: \`${input}\``,
                "",
                "Use a PvP Scalpel URL or `Name:realm:region`.",
            ].join("\n"),
            components: [
                buildJoinButtons(draftId, {
                    hasPendingTwinks: hasPendingTwinks(draft),
                }),
            ],
        });

        return true;
    }

    const charString = normalizeCharacterString(character.data);

    if (!draft.characters.includes(charString)) {
        draft.characters.push(charString);
    }

    let rerolls = [];

    try {
        const result = await extRetChar({
            name: character.data?.name,
            realm: character.data?.playerRealm?.slug || character.data?.realmSlug,
            server: character.data?.server,
        });

        rerolls = result?.twinks || result?.rerolls || [];
    } catch (error) {
        console.warn("[Zugee] failed to retrieve detected alts", error);
    }

    const twinkOptions = buildTwinkOptions(rerolls, draft);

    mergePendingTwinks(draft, twinkOptions);

    await saveJoinDraft(draft);

    await editReplyNoEmbeds(interaction, {
        content: await buildJoinPreviewContent(draft),
        components: [
            buildJoinButtons(draftId, {
                hasPendingTwinks: hasPendingTwinks(draft),
            }),
        ],
    });

    return true;
}
async function populateDetectedTwinksFromCharacter(draft, characterData) {
    let rerolls = [];

    try {
        const result = await extRetChar({
            name: characterData?.name,
            realm: characterData?.playerRealm?.slug || characterData?.realmSlug,
            server: characterData?.server,
        });

        rerolls = result?.twinks || result?.rerolls || [];
    } catch (error) {
        console.warn("[Zugee] failed to retrieve detected alts", error);
    }

    const twinkOptions = buildTwinkOptions(rerolls, draft);

    mergePendingTwinks(draft, twinkOptions);

    return draft;
}

export default async function joinHandler(interaction) {
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });

    const input = interaction.options.getString("character", true);
    const character = await charRetrieve(input);

    if (character.status !== 200 || !character.data) {
        await interaction.editReply({
            content: [
                "## Character not found",
                "",
                `Input: \`${input}\``,
                "",
                "Use a PvP Scalpel URL or autocomplete character value.",
            ].join("\n"),
        });

        return true;
    }

    const charString = normalizeCharacterString(character.data);
    const draftId = await createJoinDraft(charString);

    let draft = {
        id: draftId,
        characters: [charString],
        createdAt: Date.now(),
        pendingTwinks: [],
    };

    draft = await populateDetectedTwinksFromCharacter(draft, character.data);

    await saveJoinDraft(draft);

    const content = await buildJoinPreviewContent(draft);

    await editReplyNoEmbeds(interaction, {
        content,
        components: [
            buildJoinButtons(draftId, {
                hasPendingTwinks: hasPendingTwinks(draft),
            }),
        ],
    });

    return true;
}