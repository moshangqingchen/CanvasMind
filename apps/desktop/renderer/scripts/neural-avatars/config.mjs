/** User supplied artwork. These crops deliberately exclude the side/back views. */
export const avatarConfig = [
  { module: "canvases", file: "pink-chibi-face.jpg", crop: [0, .025, 1, .975], smoothing: 1.2, threshold: 43 },
  { module: "suppliers", file: "penguin-girl-three-view.webp", crop: [.012, .158, .334, .565], smoothing: 2.7, threshold: 28, levels: [.23, .39, .57, .74] },
  { module: "accounts", file: "white-hair-headphones.webp", crop: [.168, .032, .67, .65], smoothing: 1.35, threshold: 35 },
  { module: "starts", file: "whale-maid-three-view.webp", crop: [.008, .037, .334, .58], smoothing: 1.5, threshold: 34 },
];
