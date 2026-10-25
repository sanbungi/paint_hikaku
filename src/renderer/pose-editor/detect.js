/**
 * Image → body landmarks with MediaPipe Pose Landmarker (BlazePose GHUM, 33 points).
 * The runtime (WebAssembly) ships in vendor/; the model comes from the main process
 * (downloaded once or picked from disk). Runs on the CPU so it works without a GPU.
 */
let detector = null;

export async function createDetector(modelBytes) {
  if (detector) return detector;
  const { FilesetResolver, PoseLandmarker } = await import('../vendor/mediapipe/vision_bundle.mjs');
  const wasm = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
  const fileset = await FilesetResolver.forVisionTasks(wasm);
  detector = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: modelBytes, delegate: 'CPU' },
    runningMode: 'IMAGE',
    numPoses: 1,
    minPoseDetectionConfidence: 0.3,
    minPosePresenceConfidence: 0.3,
  });
  return detector;
}

export const hasDetector = () => detector !== null;

/** { world, image } landmarks of the most prominent person, or null if nobody was found. */
export function detectPose(image) {
  const r = detector.detect(image);
  if (!r.worldLandmarks?.length) return null;
  const copy = (list) => list.map(({ x, y, z, visibility }) => ({ x, y, z, visibility: visibility ?? 1 }));
  return { world: copy(r.worldLandmarks[0]), image: copy(r.landmarks[0]) };
}

/** Lines between landmarks for the preview (MediaPipe's POSE_CONNECTIONS, trimmed to the body). */
export const PoseConnections = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
  [15, 17], [15, 19], [17, 19], [16, 18], [16, 20], [18, 20], [0, 7], [0, 8],
];
