# Scholarmap Data Pipeline

Software pipeline to OCR, chunk, embed, cluster primary sources


```{bash}
micromamba create -n scholarmap-data python=3.13 pandas polars numpy openai tiktoken langchain-text-splitters mistralai cupy && pip install lmstudio
```