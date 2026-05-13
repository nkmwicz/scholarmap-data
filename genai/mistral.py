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
    delay = 4  # Delay in seconds between API calls to avoid rate limits
    api_key = os.environ["MISTRAL_KEY"]
    MODEL_ID = "mistral-large-latest"
    # MODEL_ID = "mistral-small-latest"
    # MODEL_ID = "mistral-small-latest"
    # MODEL_ID = "mistral-3b-latest"

    client = Mistral(api_key=api_key)
    cluster_response: List[ClusterWithTags] = []
    print(
        f"Using Mistral model: {MODEL_ID}. Instituting a delay of {delay} seconds between API calls to avoid rate limits."
    )

    system_prompt: str = """You are an forensic historian. 

Your goal is to synthesize clusters of text fragments (letters, book chunks, and manuscripts) grouped by semantic vector similarity.
You understand that 16th-century orthography is inconsistent and focus on the underlying semantic 'intent' and 'domain' (e.g., juridical, domestic, theological, or mercantile)."""

    for cluster in clusters:
        samples = "---\n---\n".join(cluster.tags)
        if is_sub_cluster:
            prompt = f"""
ROLE: You are a Forensic Paleographer and Strategic Analyst of Early Modern Statecraft. 
Your goal is to identify the commonalities between all provided samples that tie the subcluster together. What makes is specific WITHIN the Parent Cluster themes.

PARENT CLUSTER CONTEXT: 
The high-level domain labels are as follows: {parent_cluster_labels}.

TASK:
Examine the provided samples. Identify 5 labels (CamelCase, max 3 words) that define the . 
What commonalities across all the samples make these specific documents distinct from the broader parent cluster? Why were these documents grouped together at the sub-cluster level, and what specific topical glue ties them together?
Make sure the labels reflect all samples. These samples are representative of a broader sub-cluster, so the labels should not be specific to one or two documents, but all of them.

STRICT NEGATIVE CONSTRAINTS:
1. DO NOT REPEAT PARENT LABELS: If the parent is 'Diplomacy', the sub-label must be more granular.
2. NO HALLUCINATIONS: Do not assume a 'Religious' or 'Papal' theme just because you see a Bishop or Cardinal. Look at what they are DOING (e.g., are they arresting someone, or asking for money?).
3. IGNORE BOILERPLATE: 16th-century letters follow formal models. Ignore the 'Your Humble Servant' and 'Most Christian King' noise. Look for the 'News' in the middle.

GUIDELINES FOR LABELS:
1. FIND THE PATTERNS: What specific concerns, people, geography or places, events, or topics hold these samples together?
2. DIFFERENTIATE: Each of the 5 labels should capture a distinct angle (Subject, Tone, Actors, or Context).
1. PRIMARY AGENT/ENTITY: Who is the actual driver of this specific group?
2. GEOGRAPHIC ANCHOR: Is there a specific border, city, or front?
3. SOCIAL REGISTER: What is the nature of the power dynamic? 
4. MOTIF/CONCERN: What is the recurring strategic anxiety or optimism?

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
