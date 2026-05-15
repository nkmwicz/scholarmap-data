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


class LetterSummary(BaseModel):
    author: str
    author_location: str
    recipient_location: str
    recipient: str
    date: str
    summary: str
    people_referenced: list[str]
    places_referenced: list[str]
    events_referenced: list[str]


class ChapterSummary(BaseModel):
    summary: str
    people_referenced: list[str]
    places_referenced: list[str]
    events_referenced: list[str]


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

    system_prompt: str = """
Your goal is to synthesize clusters of text fragments (letters, book chunks, and manuscripts) grouped by semantic vector similarity.
You understand that 16th-century orthography is inconsistent and focus on the underlying semantic 'intent' and 'domain' (e.g., juridical, domestic, theological, or mercantile)."""

    for cluster in clusters:
        samples = "---\n---\n".join(cluster.tags)
        if is_sub_cluster:
            prompt = f"""
The following samples come from representative documents from a specific sub-cluster of a parent cluster. Cosine similarity was used to group these documents together. 

Your goal is to identify the commonalities between all provided samples that tie the subcluster together. What makes is specific WITHIN the Parent Cluster themes.


TASK:
Examine the provided samples. Identify 5 labels (CamelCase, max 3 words) that define the subcluster as a distincty entity within the parent cluster. 
What commonalities across all the samples make these specific documents distinct from the broader parent cluster? Why were these documents grouped together at the sub-cluster level, and what specific topical glue ties them together?
Make sure the labels reflect all samples. These samples are representative of a broader sub-cluster, so the labels should not be specific to one or two documents, but all of them.

STRICT NEGATIVE CONSTRAINTS:
1. DO NOT REPEAT PARENT LABELS: If the parent is 'Diplomacy', the sub-label must be more granular.
2. NO HALLUCINATIONS: Do not assume a 'Religious' or 'Papal' theme just because you see a Bishop or Cardinal. Look at what they are DOING (e.g., are they arresting someone, or asking for money?).
3. IGNORE BOILERPLATE: 16th-century letters follow formal models. Ignore the 'Your Humble Servant' and 'Most Christian King' noise. Look for the 'News' in the middle.
4. Do not become overly fixated on specific names that only occur in one or two samples. The labels should reflect the commonalities across all samples, not just one or two outliers.

GUIDELINES FOR LABELS:
1. FIND THE PATTERNS: What specific concerns, people, geography or places, events, or topics hold these samples together?
2. DIFFERENTIATE: Each of the 5 labels should capture a distinct angle (Subject, Tone, Actors, or Context).
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


def get_mistral_summary(
    text: str,
) -> LetterSummary:
    api_key = os.environ["MISTRAL_KEY"]
    MODEL_ID = "mistral-large-latest"
    client = Mistral(api_key=api_key)
    system_prompt: str = (
        """You are an early modern historian. Your task is to read the following letter and extract the key information about the letter's author, recipient, date, summary, and any people, places, or events referenced in the letter. The letter is written in 16th-century English and may contain archaic language and spelling. Focus on the underlying meaning and intent of the letter rather than getting caught up in the orthographic quirks of the period."""
    )
    prompt = f"""Read the following letter and extract the key information about the letter's author, recipient, date, summary, and any people, places, or events referenced in the letter. The letter is written in 16th-century English, French, Latin, Italian, or Turkish and may contain archaic language and spelling. Return the following informaiton:
    
1. Author: Who wrote the letter?
2. Author Location: Where was the author located when they wrote the letter?
3. Recipient: Who was the letter addressed to?
4. Recipient Location: Where was the recipient located when they received the letter?
5. Date: When was the letter written?
6. Summary: What is the main point or purpose of the letter?
7. People Referenced: List any people mentioned in the letter.
8. Places Referenced: List any places mentioned in the letter.
9. Events Referenced: List any events mentioned in the letter.

LETTER:
{text}
    """

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
            response_format=LetterSummary,
        )
        summary: LetterSummary = chat_response.choices[0].message.parsed
        return summary
    except Exception as e:
        print(f"Error occurred while summarizing letter: {e}")
        return LetterSummary(
            author="",
            author_location="",
            recipient_location="",
            recipient="",
            date="",
            summary="",
            people_referenced=[],
            places_referenced=[],
            events_referenced=[],
        )


def get_mistral_chapter_summary(text: str) -> ChapterSummary:
    api_key = os.environ["MISTRAL_KEY"]
    MODEL_ID = "mistral-large-latest"
    client = Mistral(api_key=api_key)
    system_prompt = (
        "You are an early modern historian. Your task is to read the following text excerpt "
        "and extract its key content: a concise summary and any people, places, or events referenced. "
        "The text may be in English, French, Latin, Italian, or Turkish and may contain archaic language."
    )
    prompt = f"""Read the following text and extract:

1. Summary: What is the main subject or argument of this passage?
2. People Referenced: List any people mentioned.
3. Places Referenced: List any places mentioned.
4. Events Referenced: List any events mentioned.

TEXT:
{text}
"""
    try:
        chat_response = client.chat.parse(
            model=MODEL_ID,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            response_format=ChapterSummary,
        )
        return chat_response.choices[0].message.parsed
    except Exception as e:
        print(f"Error occurred while summarizing chapter: {e}")
        return ChapterSummary(
            summary="",
            people_referenced=[],
            places_referenced=[],
            events_referenced=[],
        )
