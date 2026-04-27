import { fetchSearchDump } from "../helpers/searchDump.js";

export default async function searchHandler(interaction) {
    const search = interaction.options.getString("search", true);

    await interaction.deferReply();
    await interaction.editReply(await fetchSearchDump(search));
}
