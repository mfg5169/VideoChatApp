import imagehash
from PIL import Image
from skimage.metrics import structural_similarity as ssim
import cv2



def frame_changed(frame, prev_hash, threshold=5):
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    h = imagehash.phash(img)
    if prev_hash is None:
        return True, h
    return (h - prev_hash) > threshold, h




def is_different(frame_a, frame_b, threshold=0.2):
    grayA = cv2.cvtColor(frame_a, cv2.COLOR_BGR2GRAY)
    grayB = cv2.cvtColor(frame_b, cv2.COLOR_BGR2GRAY)
    score, _ = ssim(grayA, grayB, full=True)
    return score < (1 - threshold)  # lower SSIM = more change


prev_hash = None
results = []
#https://huggingface.co/docs/transformers/en/model_doc/pix2struct
# https://huggingface.co/docs/transformers/en/model_doc/llava_next
for ts, frame in frame_generator("screen.mp4"):
    changed, new_hash = frame_changed(frame, prev_hash, threshold=6)
    if changed:
        # Run analysis only here
        description = run_llava(frame, "Summarize what is visible.")
        results.append({"t": ts, "desc": description})
        prev_hash = new_hash
