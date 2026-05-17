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
    """V1 — kept for backward compatibility with existing JSONB records."""

    author: str
    author_location: str
    recipient_location: str
    recipient: str
    date: str
    summary: str
    people_referenced: list[str]
    places_referenced: list[str]
    events_referenced: list[str]


class NoteExtract(BaseModel):
    summary: str
    people_referenced: list[str]
    places_referenced: list[str]
    events_referenced: list[str]


class LetterSummaryV2(BaseModel):
    """V2 — hierarchical: letter metadata + sequential discrete-matter notes."""

    version: int = 2
    author: str
    author_location: str
    recipient_location: str
    recipient: str
    date: str
    summary: str
    notes: list[NoteExtract]


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
) -> LetterSummaryV2:
    api_key = os.environ["MISTRAL_KEY"]
    MODEL_ID = "mistral-large-latest"
    client = Mistral(api_key=api_key)
    system_prompt: str = (
        "You are an expert early modern historian and archivist. "
        "Your task is to analyse a letter and extract two layers of information: "
        "(1) letter-level metadata, and "
        "(2) a sequential breakdown ofthe principal matters, pieces of business, or news the letter substantively addresses — "
        "what a secretary or archivist would record as the letter's main 'articles'."
        "The letter may be written in 16th-century English, French, Latin, Italian, or Turkish "
        "and may contain archaic language and spelling. "
        "Focus on the underlying meaning and intent rather than orthographic quirks."
    )
    prompt = f"""Read the following letter and extract two levels of information.

LETTER-LEVEL METADATA:
1. Author: Who wrote the letter?
2. Author Location: Where was the author writing from?
3. Recipient: Who is the letter addressed to?
4. Recipient Location: Where was the recipient?
5. Date: When was the letter written?
6. Summary: Overview of the letter's main purpose.

NOTE-LEVEL — DISCRETE MATTERS (in the order they appear):
Identify each distinct topic, news item, or piece of business the writer discusses.
For each note provide:
- summary: A few sentences describing this specific matter
- people_referenced: people mentioned in this matter
- places_referenced: places mentioned in this matter
- events_referenced: events mentioned in this matter

RULES:
- A letter may have 1 to 7 notes. Most letters have 2-4.
- Do NOT create notes for epistolary boilerplate (greetings, closings, expressions of loyalty).
- Each note must represent a substantively different matter from the others.
- If the entire letter concerns a single matter, return exactly one note.

LETTER:
{text}
    """

    try:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        chat_response = client.chat.parse(
            model=MODEL_ID,
            messages=messages,
            response_format=LetterSummaryV2,
        )
        summary: LetterSummaryV2 = chat_response.choices[0].message.parsed

        summary.version = 2  # Explicitly set verion to 2 for clarity.
        return summary
    except Exception as e:
        print(f"Error occurred while summarizing letter: {e}")
        return LetterSummaryV2(
            author="",
            author_location="",
            recipient_location="",
            recipient="",
            date="",
            summary="",
            notes=[],
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
