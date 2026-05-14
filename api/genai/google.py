from google import genai
from dotenv import load_dotenv
import os
from pydantic import BaseModel
from typing import List

load_dotenv()

gemini_api = os.getenv("GEMINI_API_KEY")

client = genai.Client(api_key=gemini_api)


class Cluster(BaseModel):
    label: int | str
    tags: list[str]


class ClusterWithTags(BaseModel):
    label: int | str
    tags: list[str]


class ClusterGeminiModel(BaseModel):
    label1: str
    label2: str
    label3: str
    label4: str
    label5: str


MODEL_ID = "gemini-3-flash-preview"


def get_gemini_cluster_tags(clusters: List[Cluster]) -> List[ClusterWithTags]:
    """
    Given a list of clusters, generate 5 tags for each cluster using the Gemini model.

    Args:
        clusters (List[Cluster]): A list of Cluster objects, each containing a label and a list of tags.

    Returns:
        List[ClusterWithTags]: A list of ClusterWithTags objects, each containing the original
        label and the generated tags.

    """
    cluster_response: List[ClusterWithTags] = []

    for cluster in clusters:
        samples = "---\n---\n".join(cluster.tags)
        prompt = f"""Generate 5 tags for the following cluster of research papers:

{samples}

Return the tags in a JSON object with keys 'label1', 'label2', 'label3', 'label4', and 'label5'."""

        res = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": ClusterGeminiModel,
            },
        )
        tags: ClusterGeminiModel = res.parsed
        tags_list = [tags.label1, tags.label2, tags.label3, tags.label4, tags.label5]
        cluster_response.append(ClusterWithTags(label=cluster.label, tags=tags_list))
    return cluster_response
