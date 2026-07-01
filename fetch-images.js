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
  "Acer", "Willow Tree"
];

(async () => {
  const results = {};

  for (const plant of plants) {
    const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(plant)}&iconic_taxa=Plantae&per_page=1&locale=en`;
    const res = await fetch(url);
    const data = await res.json();
    const photo = data.results?.[0]?.default_photo?.medium_url ?? null;
    results[plant] = photo;
    console.error(`${photo ? '✓' : '✗'} ${plant}`);
  }

  process.stdout.write(JSON.stringify(results, null, 2));
})();