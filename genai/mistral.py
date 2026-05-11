import os
from typing import List
from mistralai.client import Mistral
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

api_key = os.environ["MISTRAL_KEY"]
MODEL_ID = "mistral-large-latest"

client = Mistral(api_key=api_key)
messages = [
    {
        "role": "user",
        "content": "What is the best French meal? Return the name and the ingredients in short JSON object.",
    }
]


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

    system_prompt: str = """You are an expert Early Modern historian specializing in the sixteenth and seventeenth centuries. 
You are skilled at Paleography and the analysis of Early Modern rhetorical structures. 
Your goal is to synthesize clusters of text fragments (letters, book chunks, and manuscripts) grouped by semantic vector similarity.
You understand that 16th-century orthography is inconsistent and focus on the underlying semantic 'intent' and 'domain' (e.g., juridical, domestic, theological, or mercantile)."""

    for cluster in clusters:
        samples = "---\n---\n".join(cluster.tags)
        prompt = f"""Generate 5 labels (single words or short phrases) that describe the main topic / idea that holds these documents together in the cluster. These texts are representative of the contents of a cluster of texts. The labels should be descriptive of the main ideas in the cluster, and should be concise. The labels should be different from each other. The labels should be relevant to the contents of the cluster.:

{samples}

Return the labels in a JSON object with keys 'label1', 'label2', 'label3', 'label4', and 'label5'."""

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": prompt,
            },
        ]
        chat_response = client.chat.parse(
            model=MODEL_ID,
            messages=messages,
            response_format=ClusterGeminiModel,
        )
        tags: ClusterGeminiModel = chat_response.choices[0].message.parsed
        tags_list = [tags.label1, tags.label2, tags.label3, tags.label4, tags.label5]
        cluster_response.append(ClusterWithTags(label=cluster.label, tags=tags_list))
    return cluster_response
