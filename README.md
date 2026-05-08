# Scholarmap Data Pipeline

Software pipeline to OCR, chunk, embed, cluster primary sources


```{bash}
micromamba create -n scholarmap-data -c pytorch -c nvidia -c anaconda -c conda-forge python=3.12 pytorch pytorch-cuda=12.4 pandas requests polars numpy openai tiktoken langchain-text-splitters jupyter mistralai google-genai ollama-python python-dotenv ipykernel sentence-transformers && micromamba activate scholarmap-data
```