const plants = [
  "Ivy",
  "Fern",
  "Horse Chestnut",
  "Hosta",
  "Primrose",
  "Hellebore",
  "Aquilegia",
  "Hart's Tongue Fern",
  "Silver Birch",
  "Navelwort",
  "Privet",
  "Bluebell",
  "Daffodil",
  "Snowdrop",
  "Sycamore",
  "Raspberry",
  "Hornbeam",
  "Perennial Ryegrass",
  "Hollyhock",
  "Garden Rocket",
  "Apple",
  "Hawthorn",
  "Foxglove",
  "Grape",
  "Cherry Laurel",
  "Buddleja",
  "Tomato",
  "Yellow Rose", "Pink Rose", "Red Rose", "Cherry Blossom",
  "Hydrangea", "Strawberry", "Lavender", "Crocosmia", "Geranium",
  "Acer", "Willow Tree",
  "Rhododendron",
  "Euonymus",
  "Hornbeam",
  "Phormium",
  "Fuchsia",
  "Osmanthus",
  "Sedum",
  "Photinia",
  "Camellia",
  "Red Maple",
  "Chive",
  "Oregano",
  "Shrubby Cinquefoil",
  "Hosta Undulata",
  "Gladioli",
  "Shasta Daisy",
  "Hemerocallis",
  "Heather",
  "Common Box",
  "Cornflower",
  "Escallonia",
  "Euphorbia Mellifera",
  "Rosemary",
  "Butterfly Bush",
  "Elephant Garlic",
  "Rhubarb",
  "Phlomis",
  "Oak Tree",
  "Fir Tree",
  "Asparagus Fern",
  "Elm Tree",
  "Lady's Mantles",
  "Bergenia",
  "Aucuba Japonica"
];

(async () => {
  const results = {};
  for (const plant of plants) {
    const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(plant)}&iconic_taxa=Plantae&per_page=1&locale=en`;
    try {
      const res = await fetch(url);
      const text = await res.text();
      const data = JSON.parse(text);
      const photo = data.results?.[0]?.default_photo?.medium_url ?? null;
      results[plant] = photo;
      console.error(`${photo ? '✓' : '✗'} ${plant}`);
    } catch (err) {
      results[plant] = null;
      console.error(`✗ ${plant} (error: ${err.message})`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  process.stdout.write(JSON.stringify(results, null, 2));
})();