import os
from typing import List
from mistralai.client import Mistral
from dotenv import load_dotenv
from pydantic import BaseModel
import time

load_dotenv()


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


def get_mistral_cluster_tags(
    clusters: List[Cluster],
    is_sub_cluster: bool = False,
    parent_cluster_labels: str = "",
) -> List[ClusterWithTags]:
    """
    Given a list of clusters, generate 5 tags for each cluster using the Mistral model.

    Args:
        clusters (List[Cluster]): A list of Cluster objects, each containing a label and a list of tags.

    Returns:
        List[ClusterWithTags]: A list of ClusterWithTags objects, each containing the original
        label and the generated tags.

    """
    delay = 60  # Delay in seconds between API calls to avoid rate limits
    api_key = os.environ["MISTRAL_KEY"]
    # MODEL_ID = "mistral-large-latest"
    # MODEL_ID = "mistral-small-latest"
    MODEL_ID = "mistral-small-latest"
    # MODEL_ID = "mistral-3b-latest"

    client = Mistral(api_key=api_key)
    cluster_response: List[ClusterWithTags] = []
    print(
        f"Using Mistral model: {MODEL_ID}. Instituting a delay of {delay} seconds between API calls to avoid rate limits."
    )

    system_prompt: str = """You are an expert Early Modern historian specializing in the sixteenth and seventeenth centuries. 
You are skilled at Paleography and the analysis of Early Modern rhetorical structures. 
Your goal is to synthesize clusters of text fragments (letters, book chunks, and manuscripts) grouped by semantic vector similarity.
You understand that 16th-century orthography is inconsistent and focus on the underlying semantic 'intent' and 'domain' (e.g., juridical, domestic, theological, or mercantile)."""

    for cluster in clusters:
        samples = "---\n---\n".join(cluster.tags)
        if is_sub_cluster:
            prompt = f"""
Examine these representative samples from a specific cluster. Return 5 labels that capture the 'semantic glue' that defines this group, but also situate it within the larger parent cluster.  

This group is a sub-cluster of a larger parent cluster defined by the following labels: 

- {parent_cluster_labels}.

You need to find the the shared motifs, social registers, or specific historical concerns that make this group of samples distinct within the parent cluster. 

Each label should strive to be one word or three words at maximum (use CamelCase), and should capture a distinct aspect of the sub-cluster's identity that crosses all samples.

GUIDELINES FOR LABELS:

- **Focus on Specific Commonalities:** Are there central people (e.g., 'JohnDoe'), places (e.g., 'London', 'Rome', 'OttomanEmpire'), events (e.g., 'FrenchWarsOfReligion'), or institutions (e.g., 'Parlement') that tie this sub-cluster together?
- **Differentiate:** Each of the 5 labels should provide a unique angle (People, places, things, events) that appear to be a substratum of the parent cluster lables.
- **Ignore Noise:** Disregard standard epistolary formulas (e.g., 'your humble servant') unless they define the cluster's formal register.

SAMPLES:

{samples}
            """
        else:
            prompt = f"""
Examine theserepresentative samples from a specific cluster. Return 5 labels that capture the 'semantic glue' that defines this group.

Identify the 'semantic glue'—the shared motifs, social registers, or specific historical concerns—that defines this group. Each label should strive to be one word or three words at maximum (use CamelCase), and should capture a distinct aspect of the sub-cluster's identity that crosses all samples.

GUIDELINES FOR LABELS:
- **Avoid Anachronism:** Use period-appropriate terminology (e.g., 'Natural Philosophy' instead of 'Science').
- **Be Specific:** Instead of 'Law', use 'Chancery Litigation' or 'Property Dispute'.
- **Differentiate:** Each of the 5 labels should provide a unique angle (Subject, Tone, Actors, or Context).
- **Ignore Noise:** Disregard standard epistolary formulas (e.g., 'your humble servant') unless they define the cluster's formal register.

SAMPLES:

{samples}
            """

        success = False
        retries = 0
        while not success and retries < 3:
            try:
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
                tags_list = [
                    tags.label1,
                    tags.label2,
                    tags.label3,
                    tags.label4,
                    tags.label5,
                ]
                cluster_response.append(
                    ClusterWithTags(label=cluster.label, tags=tags_list)
                )
                time.sleep(delay)  # Add a delay to avoid overwhelming the API
                success = True
            except Exception as e:
                print(f"Error occurred while processing cluster {cluster.label}: {e}")
                retries += 1
                time.sleep(delay)  # Wait before retrying
    return cluster_response
