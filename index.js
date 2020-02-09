const util = require("util");
const exec = util.promisify(require("child_process").exec);
const tempy = require("tempy");

// convert template.jpg mask.png -alpha off -colorspace gray -compose copyopacity -composite masked_template.png
async function generateNormalizedTemplateMap(params) {
  const { template, mask, out } = params;

  const tmp = tempy.file({ extension: "png" });

  const applyMask = `convert ${template} ${mask} -alpha off -colorspace gray -compose CopyOpacity -composite ${tmp}`;
  await exec(applyMask);

  const { stdout: brightnessDelta } = await exec(
    `convert ${tmp} -format "%[fx:100*mean-50]" info:`
  );

  const adjustBrightness = `convert ${tmp} -evaluate subtract ${brightnessDelta}% ${out}`;
  await exec(adjustBrightness);
}

async function generateLightingMap(params) {
  await generateNormalizedTemplateMap(params);
}

async function generateDisplacementMap(params) {
  const { template, mask, out } = params;
  const { blur = 10 } = params;

  const tmp = tempy.file({ extension: "png" });
  await generateNormalizedTemplateMap({ template, mask, out: tmp });

  await exec(`convert ${tmp} -blur 0x${blur} ${out}`);
}

// convert template.jpg -alpha transparent \( artwork.png +distort perspective "0,0,940,2650,0,2000,940,3460,2000,2000,1740,3540,2000,0,1740,2800" \) -background transparent -layers merge +repage artwork_distorted.png
async function perspectiveTransform(params) {
  const { template, artwork, out } = params;
  const [x1, y1, x2, y2, x3, y3, x4, y4] = params.coordinates;
  const [w, h] = await exec(
    `identify -format "%w,%h" ${artwork}`
  ).then(({ stdout }) => stdout.split(",").map(s => parseInt(s)));

  const coordinates = [0, 0, x1, y1, 0, h, x2, y2, w, h, x3, y3, w, 0, x4, y4];

  const transform = `convert ${template} -alpha transparent \\( ${artwork} +distort perspective "${coordinates.join()}" \\) -background transparent -layers merge +repage ${out}`;
  await exec(transform);
}

// convert artwork_distorted.png \( masked_template_gray.png -blur 0x10 \) -compose displace -set option:compose:args 10x10 -composite artwork_displaced.png
async function addDisplacement(params) {
  const { artwork, displacementMap, out } = params;
  const { dx = 10, dy = 10 } = params;

  const displace = `convert ${artwork} ${displacementMap} -compose displace -set option:compose:args ${dx}x${dy} -composite ${out}`;
  await exec(displace);
}

// convert artwork_displaced.png \( -clone 0 masked_template_corrected.png -compose hardlight -composite \) +swap -compose copy_opacity -composite artwork_final.png
async function addHighlights(params) {
  const { artwork, lightingMap, out } = params;
  const { mode = "hardlight" } = params;

  const highlight = `convert ${artwork} \\( -clone 0 ${lightingMap} -compose ${mode} -composite \\) +swap -compose CopyOpacity -composite ${out}`;
  await exec(highlight);
}

async function composeArtwork(params) {
  const { template, artwork, mask, out } = params;
  const compose = `convert ${template} ${artwork} ${mask} -compose multiply -composite ${out}`;
  await exec(compose);
}

// convert template.jpg -compose multiply artwork_final.png -composite mockup.jpg
async function generateMockup(params) {
  const { template, artwork, mask, displacementMap, lightingMap, out } = params;
  const { coordinates } = params;

  const tmp = tempy.file({ extension: "png" });
  await perspectiveTransform({ template, artwork, coordinates, out: tmp });
  await addDisplacement({ artwork: tmp, displacementMap, out: tmp });
  await addHighlights({ artwork: tmp, lightingMap, out: tmp });
  await composeArtwork({ artwork: tmp, template, mask, out });
}

Promise.all([
  generateDisplacementMap({
    template: "template.jpg",
    mask: "mask.png",
    out: "displace.png"
  }),
  generateLightingMap({
    template: "template.jpg",
    mask: "mask.png",
    out: "lighting.png"
  })
]).then(() => {
  generateMockup({
    template: "template.jpg",
    artwork: "artwork.png",
    mask: "mask.png",
    displacementMap: "displace.png",
    lightingMap: "lighting.png",
    coordinates: [940, 2650, 940, 3460, 1740, 3540, 1740, 2800],
    out: "mockup.jpg"
  });
});
