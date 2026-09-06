#!/usr/bin/env python
"""
Score de similarité de visage (contrôle qualité d'identité).

Compare un portrait de référence à des images candidates avec les modèles
OpenCV Zoo : YuNet (détection) + SFace (reconnaissance, ONNX). Similarité cosinus ;
seuil documenté par OpenCV pour « même personne » : 0.363.

  python tools/qc/face_score.py --ref <url|fichier> <candidat> [<candidat> ...]
  python tools/qc/face_score.py --ref <url> --json results.json   # scorer un JSON du banc d'essai

Sortie : une ligne JSON par candidat {"url", "score", "faces", "face_h", "same"}
(face_h = hauteur du visage retenu / hauteur de l'image ; sous ~0,12 le score n'est plus fiable).
"""
import argparse
import json
import os
import sys
import tempfile
import urllib.request

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DET = os.path.join(HERE, "models", "face_detection_yunet_2023mar.onnx")
REC = os.path.join(HERE, "models", "face_recognition_sface_2021dec.onnx")
THRESHOLD = 0.363  # cosinus, valeur recommandée par OpenCV pour SFace


def load_image(src: str):
    if src.startswith("http://") or src.startswith("https://"):
        with urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": "viralya-qc"}), timeout=60) as r:
            data = np.frombuffer(r.read(), np.uint8)
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    else:
        img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"image illisible : {src}")
    # Les détecteurs travaillent mieux sous ~1600 px de côté.
    h, w = img.shape[:2]
    scale = 1600 / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


class Scorer:
    def __init__(self):
        if not (os.path.exists(DET) and os.path.exists(REC)):
            raise SystemExit("modèles manquants dans tools/qc/models (voir README)")
        self.det = cv2.FaceDetectorYN.create(DET, "", (320, 320), 0.7, 0.3, 5000)
        self.rec = cv2.FaceRecognizerSF.create(REC, "")

    def faces(self, img):
        h, w = img.shape[:2]
        self.det.setInputSize((w, h))
        _, faces = self.det.detect(img)
        return faces if faces is not None else np.zeros((0, 15), np.float32)

    def feature(self, img, face):
        aligned = self.rec.alignCrop(img, face)
        return self.rec.feature(aligned)

    def score(self, ref_feat, img):
        """Score du visage le plus ressemblant parmi ceux détectés (le personnage
        n'est pas toujours le plus grand visage : passants, reflets, foule).
        Renvoie aussi la hauteur relative de ce visage (fraction de la hauteur de
        l'image) : SFace devient peu fiable sous ~12 % (plan large, profil)."""
        faces = self.faces(img)
        if len(faces) == 0:
            return None, 0, None
        # Au plus 8 visages, les plus grands d'abord (le sujet est rarement minuscule).
        cands = sorted(faces, key=lambda f: -float(f[2]) * float(f[3]))[:8]
        best, best_h = None, None
        img_h = float(img.shape[0])
        for f in cands:
            sc = float(self.rec.match(ref_feat, self.feature(img, f), cv2.FaceRecognizerSF_FR_COSINE))
            if best is None or sc > best:
                best, best_h = sc, float(f[3]) / img_h
        return best, int(len(faces)), best_h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True, help="portrait de référence (url ou fichier)")
    ap.add_argument("--json", help="fichier JSON du banc d'essai : score ajouté à chaque entrée avec url")
    ap.add_argument("candidates", nargs="*")
    args = ap.parse_args()

    s = Scorer()
    ref_img = load_image(args.ref)
    ref_faces = s.faces(ref_img)
    if len(ref_faces) == 0:
        raise SystemExit("aucun visage détecté dans la référence")
    ref_feat = s.feature(ref_img, max(ref_faces, key=lambda f: float(f[2]) * float(f[3])))

    if args.json:
        with open(args.json, encoding="utf-8") as f:
            rows = json.load(f)
        for row in rows:
            url = row.get("url")
            if not url:
                row["face_score"] = None
                continue
            try:
                sc, n, fh = s.score(ref_feat, load_image(url))
            except Exception as e:  # noqa: BLE001
                sc, n, fh = None, 0, None
                row["face_error"] = str(e)
            row["face_score"] = sc
            row["faces"] = n
            row["face_h"] = fh
            row["same_person"] = (sc is not None and sc >= THRESHOLD)
            print(json.dumps({"model": row.get("model"), "scene": row.get("scene"), "score": sc, "faces": n, "face_h": fh}, ensure_ascii=False))
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        return

    for c in args.candidates:
        try:
            sc, n, fh = s.score(ref_feat, load_image(c))
            print(json.dumps({"url": c, "score": sc, "faces": n, "face_h": fh, "same": sc is not None and sc >= THRESHOLD}, ensure_ascii=False))
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"url": c, "error": str(e)}, ensure_ascii=False), file=sys.stderr)


if __name__ == "__main__":
    main()
