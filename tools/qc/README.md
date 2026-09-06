# tools/qc — contrôle qualité d'identité

Score de similarité entre un portrait de référence et une image générée, avec les modèles
OpenCV Zoo (licence Apache 2.0) : **YuNet** pour la détection, **SFace** pour la reconnaissance.
Similarité cosinus ; seuil « même personne » recommandé par OpenCV : **0.363**.

## Installation

```bash
pip install opencv-python numpy
# modèles (Git LFS, ~15 Mo + 230 Ko) :
curl -L -o tools/qc/models/face_detection_yunet_2023mar.onnx \
  https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -L -o tools/qc/models/face_recognition_sface_2021dec.onnx \
  https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
```

## Usage

```bash
python tools/qc/face_score.py --ref <portrait.jpg|url> <image1> <image2> ...
python tools/qc/face_score.py --ref <url> --json bench.json     # enrichit un JSON du banc d'essai
```

Le score trie, l'humain tranche : sur des visages synthétiques le seuil se calibre
(voir `docs/PLAN-REFONTE.md`, section QC).
