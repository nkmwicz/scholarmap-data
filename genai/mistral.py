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
        prompt = f"""
Examine these 10 representative samples from a specific cluster. 
Identify the 'semantic glue'—the shared motifs, social registers, or specific historical concerns—that defines this group. Each label should strive to be one word or three words at maximum (use CamelCase), and should capture a distinct aspect of the cluster's identity that crosses all samples.

GUIDELINES FOR LABELS:
- **Avoid Anachronism:** Use period-appropriate terminology (e.g., 'Natural Philosophy' instead of 'Science').
- **Be Specific:** Instead of 'Law', use 'Chancery Litigation' or 'Property Dispute'.
- **Differentiate:** Each of the 5 labels should provide a unique angle (Subject, Tone, Actors, or Context).
- **Ignore Noise:** Disregard standard epistolary formulas (e.g., 'your humble servant') unless they define the cluster's formal register.

SAMPLES:
{samples}


"""

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
