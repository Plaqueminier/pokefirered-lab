import { expect, test } from "bun:test";
import { readFlyData } from "./fly-destinations";

test("the Fly destinations of Kanto are the 11 towns and the 2 Pokémon Centers of the routes, each on its cell in front of the Pokémon Center", async () => {
  const { destinations } = await readFlyData();
  expect(destinations.filter((d) => d.region === "kanto").map(({ name, map, x, y }) => [name, map, x, y])).toEqual([
    ["Pallet Town", "PalletTown", 6, 8],
    ["Viridian City", "ViridianCity", 26, 27],
    ["Pewter City", "PewterCity", 17, 26],
    ["Cerulean City", "CeruleanCity", 22, 20],
    ["Lavender Town", "LavenderTown", 6, 6],
    ["Vermilion City", "VermilionCity", 15, 7],
    ["Celadon City", "CeladonCity", 48, 12],
    ["Fuchsia City", "FuchsiaCity", 25, 32],
    ["Cinnabar Island", "CinnabarIsland", 14, 12],
    ["Indigo Plateau", "IndigoPlateau_Exterior", 11, 7],
    ["Saffron City", "SaffronCity", 24, 39],
    ["Route 4 Pokémon Center", "Route4", 12, 6],
    ["Route 10 Pokémon Center", "Route10", 13, 21],
  ]);
  expect(destinations.find((d) => d.map === "PalletTown")).toMatchObject({ area: "Pallet Town", flag: 0x890, tile: { x: 4, y: 11 } });
  expect(destinations.find((d) => d.map === "Route4")).toMatchObject({ area: "Route 4" });
  expect(destinations.filter((d) => d.region !== "kanto").map((d) => d.map)).toEqual(["OneIsland", "TwoIsland", "ThreeIsland", "FourIsland", "FiveIsland", "SevenIsland", "SixIsland"]);
});

test("a map is in the region of its map section, and a section that the fly map does not show is in Kanto, as in the game", async () => {
  const { regions } = await readFlyData();
  expect(["SilphCo_1F", "SSAnne_Exterior", "UndergroundPath_NorthEntrance", "SafariZone_Center", "MtMoon_1F"].map((map) => regions.get(map))).toEqual(["kanto", "kanto", "kanto", "kanto", "kanto"]);
  expect(["OneIsland", "MtEmber_Exterior", "FourIsland", "SixIsland"].map((map) => regions.get(map))).toEqual(["sevii_123", "sevii_123", "sevii_45", "sevii_67"]);
});
