const util = require("util");
const exec = util.promisify(require("child_process").exec);
const tempy = require("tempy");

// convert template.jpg mask.png -alpha off -colorspace gray -compose copyopacity -composite masked_template.png
async function generateNormalizedTemplateMap(params) {
  const { template, mask, out } = params;

  const tmp = tempy.file({ extension: "mpc" });

  const applyMask = `convert ${template} ${mask} -alpha off -colorspace gray -compose CopyOpacity -composite ${tmp}`;
  await exec(applyMask);

  const { stdout: brightness } = await exec(
    `convert ${tmp} -background grey50 -alpha remove -format "%[fx:mean]" info:`
  );

  const { stdout: opacityAmount } = await exec(
    `convert ${mask} -format "%[fx:mean]" info:`
  );

  const brightnessDelta = (100 * (brightness - 0.5)) / opacityAmount;

  const adjustBrightness = `convert ${tmp} -evaluate subtract ${brightnessDelta}% -background grey50 -alpha remove -alpha off ${out}`;
  await exec(adjustBrightness);
}

async function generateLightingMap(params) {
  const { template, mask, out } = params;

  const tmp = tempy.file({ extension: "mpc" });
  await generateNormalizedTemplateMap({ template, mask, out: tmp });

  // await exec(`convert \\( ${tmp} -level 50%,100% \\) +level 0%,50% ${out}`);

  const removeShadows = `convert ${tmp} \\( -clone 0 -fill grey50 -colorize 100 \\) -compose lighten -composite ${out}`;
  await exec(removeShadows);
}

async function generateColorAdjustmentMap(params) {
  const { template, mask, out, color = "white" } = params;

  const adjustColor = `convert ${template} \\( -clone 0 -fill "${color}" -colorize 100 \\) ${mask} -compose DivideSrc -composite ${out}`;
  await exec(adjustColor);
}

async function generateDisplacementMap(params) {
  const { template, mask, out } = params;
  const { blur = 10 } = params;

  const tmp = tempy.file({ extension: "mpc" });
  await generateNormalizedTemplateMap({ template, mask, out: tmp });

  await exec(`convert ${tmp} -blur 0x${blur} ${out}`);
}

async function resize(params) {
  const { artwork, out } = params;
  const { size = 400 } = params;
  await exec(`convert ${artwork} -scale ${size} ${out}`);
}

async function addBorder(params) {
  const { artwork, out } = params;
  await exec(`convert ${artwork} -bordercolor transparent -border 1 ${out}`);
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

async function adjustColors(params) {
  const { artwork, adjustmentMap, out } = params;

  const adjust = `convert ${artwork} \\( -clone 0 ${adjustmentMap} -compose multiply -composite \\) +swap -compose CopyOpacity -composite ${out}`;
  await exec(adjust);
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
  const compose = `convert ${template} ${artwork} ${mask} -compose over -composite ${out}`;
  await exec(compose);
}

// convert template.jpg -compose multiply artwork_final.png -composite mockup.jpg
async function generateMockup(params) {
  const {
    template,
    artwork,
    mask,
    displacementMap,
    lightingMap,
    adjustmentMap,
    out
  } = params;
  const { coordinates } = params;

  const tmp = tempy.file({ extension: "mpc" });
  await resize({ artwork, out: tmp });
  await addBorder({ artwork: tmp, out: tmp });

  await perspectiveTransform({ template, artwork: tmp, coordinates, out: tmp });
  await addDisplacement({ artwork: tmp, displacementMap, out: tmp });
  await addHighlights({ artwork: tmp, lightingMap, out: tmp });
  await adjustColors({ artwork: tmp, adjustmentMap, out: tmp });
  await composeArtwork({ artwork: tmp, template, mask, out });
}

Promise.all([
  generateDisplacementMap({
    template: "templates/22-template.jpg",
    mask: "templates/22-mask.png",
    out: "templates/22-displace.png"
  }),
  generateLightingMap({
    template: "templates/22-template.jpg",
    mask: "templates/22-mask.png",
    out: "templates/22-lighting.png"
  }),
  generateColorAdjustmentMap({
    template: "templates/22-template.jpg",
    color: "white",
    mask: "templates/22-mask.png",
    out: "templates/22-adjust.png"
  })
]).then(() => {
  generateMockup({
    template: "templates/22-template.jpg",
    artwork: "maruchan.png",
    mask: "templates/22-mask.png",
    displacementMap: "templates/22-displace.png",
    lightingMap: "templates/22-lighting.png",
    adjustmentMap: "templates/22-adjust.png",
    coordinates: [520, 772, 626, 1152, 926, 1140, 848, 722],
    out: "22-mockup.jpg"
  });
});

// [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 16, 17, 18, 19, 20, 21, 22, 23].forEach(
//   index => {
//     generateDisplacementMap({
//       template: `templates/${index}-template.jpg`,
//       mask: `templates/${index}-mask.png`,
//       out: `templates/${index}-displace.png`
//     }),
//     generateLightingMap({
//       template: `templates/${index}-template.jpg`,
//       mask: `templates/${index}-mask.png`,
//       out: `templates/${index}-lighting.png`
//     });
//     generateColorAdjustmentMap({
//       template: `templates/${index}-template.jpg`,
//       mask: `templates/${index}-mask.png`,
//       color: "#f1f1f1", // change this color for template 16 and 17
//       out: `templates/${index}-adjust.jpg`
//     });
//   }
// );
