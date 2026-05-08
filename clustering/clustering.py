import random
import numpy as np
from openai import OpenAI
import os
import dotenv

dotenv.load_dotenv()


def embed_items(texts):
    """
    Embed text into vectors.

    Parameters:
        texts (list): The collection of texts to be embedded.
    Returns:
        embeddings (list): A list of embedded vectors.
    """
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    texts = [text.replace("\n", " ") for text in texts]
    if isinstance(texts, str):
        texts = [texts]
    texts = [t.replace("\n", " ") for t in texts]
    response = client.embeddings.create(input=texts, model="text-embedding-3-small")

    return [data.embedding for data in response.data]


def normalize_rows(mat, eps=1e-10):
    """
    Normalize the rows of a matrix.

    Parameters:
        mat (np.ndarray): The input matrix.
        eps (float): A small value to avoid division by zero.

    Returns:
        np.ndarray: The row-normalized matrix.
    """
    import numpy as np

    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    return mat / (norms + eps)


def kmeans_plus_plus_init(
    X: np.ndarray, k: int, random_state: int | None = None, return_indices: bool = False
) -> np.ndarray | tuple[np.ndarray, np.ndarray]:
    """
    Construct initial cluster centroids using k-means++ algorithm for cosine similarity clustering with embedded vectors.

    Parameters:
        X (np.ndarray): The input data points (embedded vectors).
        k (int): The number of clusters.
        random_state (int): Seed for random number generator.
    Returns:
        np.ndarray: The initial cluster centroids.
    """
    n_samples, n_features = X.shape

    rng = np.random.default_rng(random_state)

    Xw = X.astype(np.float64, copy=True)
    norms = np.linalg.norm(Xw, axis=1, keepdims=True)
    Xw = Xw / (norms + 1e-10)

    first = int(rng.integers(0, n_samples))
    centroids_idx = [first]
    C = Xw[[first], :]  # (1, d)

    for _ in range(1, k):
        sims = Xw @ C.T  # (n, m)
        max_sim = np.max(sims, axis=1)  # (n,)
        d = 1.0 - max_sim  # cosine "distance" on unit sphere
        d2 = d * d
        total = d2.sum()
        if not np.isfinite(total) or total <= 1e-18:
            # All points are identical (or numerical collapse): pick random unseen
            remaining = np.setdiff1d(
                np.arange(n_samples), np.array(centroids_idx), assume_unique=False
            )
            next_idx = int(rng.choice(remaining))
        else:
            probs = d2 / total
            next_idx = int(rng.choice(n_samples, p=probs))

        centroids_idx.append(next_idx)
        C = Xw[centroids_idx, :]  # update centers matrix

    centroids_idx = np.array(centroids_idx, dtype=int)
    centroids = Xw[centroids_idx, :]
    return (centroids_idx, centroids) if return_indices else centroids


# def assign_similarities()
def setup_clusters(
    centroids: list[np.ndarray],
    embeds: np.ndarray,
    clusters: list[list[int]],
    soft_assign: bool = True,
    iter: int = 0,
) -> tuple[list[int], list[list[int]] | None, np.ndarray, int]:
    """
    Sets embeds into clusters based on cosine similarity to centroids.

    Parameters:
        centroids (list[np.ndarray]): History of centroid arrays; the last entry (centroid) is used for the current iteration.
        embeds (np.ndarray): The embedded vectors.
        clusters (list[list[int]]): The list of clusters to populate. A list for each cluster.
        soft_assign (bool): Whether to use soft assignment or hard assignment.
            When True, the margin is computed dynamically as the median relative gap between
            best and second-best cluster similarity across all points. Each document is capped
            at max(1, k // 4) cluster memberships.
    Returns:
        embed_clust (list[int]): Hard assignment — best-matching cluster index for each embed (aligned to embeds).
        soft_clusters (list[list[int]] | None): Soft membership per cluster (may overlap). None when soft_assign=False.
        centroid (np.ndarray): The final centroid array after convergence.
        iter (int): The number of iterations taken to converge.
    """
    centroids_list = centroids
    centroid = centroids_list[-1]
    X = embeds.astype(np.float64, copy=False)
    Xn = normalize_rows(X)
    C = centroid.astype(np.float64, copy=False)
    sims = Xn @ C.T  # cosine similarity
    # max_sim_indices = np.argmax(sims, axis=1)

    if soft_assign:
        k = centroid.shape[0]
        best_sim = np.max(sims, axis=1).reshape(-1, 1)  # (n, 1)

        # Dynamic margin: median relative gap between best and second-best cluster similarity.
        # If most points have a tight best/2nd-best gap, the margin shrinks accordingly.
        if k >= 2:
            sorted_sims = np.sort(sims, axis=1)[:, ::-1]
            rel_gaps = 1.0 - (sorted_sims[:, 1] / np.maximum(sorted_sims[:, 0], 1e-10))
            dynamic_margin = float(np.median(rel_gaps))
        else:
            dynamic_margin = 0.0

        soft_mask = sims >= (best_sim * (1 - dynamic_margin))

        # Cap: each document belongs to at most max(1, k // 4) clusters
        max_per_doc = max(1, k // 4)
        row_counts = soft_mask.sum(axis=1)
        over_cap = np.where(row_counts > max_per_doc)[0]
        for i in over_cap:
            top_idx = np.argpartition(sims[i], -max_per_doc)[-max_per_doc:]
            new_row = np.zeros(k, dtype=bool)
            new_row[top_idx] = True
            soft_mask[i] = new_row

        item, group = np.where(soft_mask)
        for idx, num in enumerate(group):
            clusters[num].append(int(item[idx]))

        exclusive_clusters: list[list[int]] = []
        for idx, cluster in enumerate(clusters):
            clust_set = set(cluster)
            other_clust_sets = [
                set(clusters[i]) for i in range(len(clusters)) if i != idx
            ]
            exclusive_clust = clust_set - set().union(*other_clust_sets)
            exclusive_clusters.append(list(exclusive_clust))

        new_centers: list[np.ndarray] = []
        for idx, (exclusive_grp, all_grp) in enumerate(
            zip(exclusive_clusters, clusters)
        ):
            if len(exclusive_grp) > 0:
                new_centers.append(np.mean(Xn[exclusive_grp], axis=0))
            else:
                # Find the point in this cluster that is least similar to other clusters
                other_cluster_points = []
                for jdx, other_grp in enumerate(clusters):
                    if jdx != idx:
                        other_cluster_points.extend(other_grp)

                if len(other_cluster_points) > 0 and len(all_grp) > 0:
                    # Compute similarity of each point in this cluster to other clusters
                    cluster_points = Xn[all_grp]
                    other_points = Xn[other_cluster_points]

                    # Average similarity to other cluster points
                    cross_sims = cluster_points @ other_points.T
                    avg_cross_sim = np.mean(cross_sims, axis=1)

                    # Choose point with lowest avg similarity to other clusters
                    most_distinctive_local_idx = np.argmin(avg_cross_sim)
                    most_distinctive_global_idx = all_grp[most_distinctive_local_idx]
                    new_centers.append(Xn[most_distinctive_global_idx])
                else:
                    # Last resort: keep current centroid
                    new_centers.append(C[idx])
    else:
        best_sim = np.argmax(sims, axis=1)  # gets indices
        for idx, num in enumerate(best_sim):
            clusters[num].append(int(idx))
        new_centers: list[np.ndarray] = [np.mean(Xn[grp], axis=0) for grp in clusters]

    centroids_list = list(centroids_list)
    centroids_list.append(np.array(new_centers))

    last_two = centroids_list[-2:]

    threshold = 1e-12
    last_centroid = last_two[0]
    this_centroid = last_two[1]

    change_norm = np.linalg.norm(last_centroid - this_centroid)

    if iter == 100 or change_norm < threshold:
        # Hard assignment: best-matching cluster per point via argmax over similarities
        embed_clust: list[int] = np.argmax(sims, axis=1).tolist()
        # Soft clusters: the accumulated overlap-aware membership lists, or None if hard only
        soft_clusters: list[list[int]] | None = clusters if soft_assign else None
        return embed_clust, soft_clusters, this_centroid, iter
    else:
        reset_clusters = [[] for _ in range(len(centroid))]
        iter += 1
        return setup_clusters(
            centroids_list,
            Xn,
            reset_clusters,
            soft_assign=soft_assign,
            iter=iter,
        )


def return_representative_samples(
    embeds: np.ndarray,
    clusters: list[int],
    centroids: np.ndarray,
    random_state: int = 42,
) -> list[list[int]]:
    """
    Returns 10 samples per cluster: the 7 most representative (by cosine similarity
    to the centroid) plus 3 random samples from the remainder. Combined into a single
    flat list per cluster for use in labelling (e.g. sending to an LLM).

    Parameters:
        embeds (np.ndarray): The embedded vectors.
        clusters (list[int]): Hard cluster assignment per embed (aligned to embeds).
        centroids (np.ndarray): The centroid array, shape (k, d).
        random_state (int): Seed for random sampling.

    Returns:
        list[list[int]]: One list per cluster of 10 embed indices (7 top + 3 random).
    """
    rng = np.random.default_rng(random_state)
    X = embeds.astype(np.float64, copy=False)
    Xn = normalize_rows(X)
    C = np.array(centroids).astype(np.float64, copy=False)
    sims = Xn @ C.T  # cosine similarity

    representative_samples = []
    for cluster_idx in range(len(centroids)):
        cluster_indices = [i for i, c in enumerate(clusters) if c == cluster_idx]
        cluster_sims = sims[cluster_indices, cluster_idx]

        top_local = np.argsort(cluster_sims)[-7:][::-1]
        top = [cluster_indices[i] for i in top_local]

        remaining = [idx for idx in cluster_indices if idx not in set(top)]
        k = min(3, len(remaining))
        random_picks = (
            rng.choice(remaining, size=k, replace=False).tolist() if k > 0 else []
        )

        representative_samples.append(top + random_picks)
    return representative_samples


def estimate_num_clusters(embeddings: np.ndarray, sample_size: int = 1000) -> int:
    """
    Estimate the number of clusters using the eigenvalue gap of the normalized
    Laplacian, with the cube root of n as a minimum.

    Parameters:
        embeddings (np.ndarray): The embedded vectors, shape (n, d).
        sample_size (int): Max vectors to use; randomly sampled if n exceeds this.
    Returns:
        int: Estimated number of clusters.
    """
    n = embeddings.shape[0]
    cube_root_k = max(2, round(n ** (1 / 3)) * 2)

    # Sample if n exceeds sample_size, otherwise use all
    if n > sample_size:
        rng = np.random.default_rng(42)
        indices = rng.choice(n, size=sample_size, replace=False)
        X = embeddings[indices]
    else:
        X = embeddings

    Xn = normalize_rows(X.astype(np.float64, copy=False))

    # Affinity matrix: cosine similarity clipped to [0, 1]
    A = Xn @ Xn.T
    np.clip(A, 0, 1, out=A)
    np.fill_diagonal(A, 0.0)

    # Normalized Laplacian: L = I - D^{-1/2} A D^{-1/2}
    degree = A.sum(axis=1)
    degree = np.maximum(degree, 1e-10)
    d_inv_sqrt = 1.0 / np.sqrt(degree)
    L_sym = np.eye(len(X)) - (d_inv_sqrt[:, None] * A * d_inv_sqrt[None, :])

    # eigvalsh is faster and more stable than eig for symmetric matrices
    eigenvalues = np.linalg.eigvalsh(L_sym)
    eigenvalues = np.sort(eigenvalues)

    # Find the largest gap between consecutive eigenvalues in range [2, cube_root_k * 2]
    max_search = min(cube_root_k * 2, len(eigenvalues) - 1)
    gaps = np.diff(eigenvalues[1 : max_search + 1])
    eigenvalue_gap_k = int(np.argmax(gaps)) + 2  # +2: 0-index offset + gap->count

    return max(cube_root_k, eigenvalue_gap_k)


def _score_clustering(
    embed_clust: list[int], centroids: np.ndarray, Xn: np.ndarray
) -> float:
    """
    Score a clustering result by mean intra-cluster cosine similarity.
    Higher is better — a run with no catch-all cluster will score higher
    because all documents sit closer to their respective centroids.

    Parameters:
        embed_clust (list[int]): Hard cluster assignment per embed.
        centroids (np.ndarray): Final centroid array, shape (k, d).
        Xn (np.ndarray): Row-normalised embed matrix, shape (n, d).
    Returns:
        float: Mean cosine similarity of each document to its assigned centroid.
    """
    C = normalize_rows(centroids.astype(np.float64, copy=False))
    assignments = np.array(embed_clust, dtype=int)
    assigned_centroids = C[assignments]  # (n, d)
    sims = np.einsum("ij,ij->i", Xn, assigned_centroids)  # per-doc cosine sim
    return float(np.mean(sims))


def create_cluster(
    embed_list,
    num_clusters: int | None = None,
    soft_assign: bool = True,
    n_restarts: int = 10,
    run_num: int = 0,
):
    """
    Create clusters from embedded vectors, using multiple random restarts to
    avoid poor local minima (e.g. a single catch-all cluster).

    Parameters:
        embed_list (list): The list of embedded vectors.
        num_clusters (int | None): The number of clusters. If None, estimated automatically
            using the eigenvalue gap method with cube root of n as a minimum.
        soft_assign (bool): Whether to use soft assignment or hard assignment.
            Margin and per-document cap are computed dynamically (see setup_clusters).
        n_restarts (int): Number of independent runs with different random seeds.
            The run with the highest mean intra-cluster cosine similarity is returned.
        run_num (int): Run number, used to offset the seed range for stability testing.
            Seeds used will be [run_num * n_restarts, ..., run_num * n_restarts + n_restarts - 1].
            run_num=0 uses seeds 0–9, run_num=1 uses seeds 10–19, etc.

    Returns:
        tuple:
            - embed_clust (list[int]): Hard assignment — best cluster index per embed (aligned to embeds).
            - soft_membership (list[list[int]] | None): Per-embed list of all cluster indices it was soft-assigned to (aligned to embeds). None when soft_assign=False.
            - representative_samples (list[list[int]]): 10 samples per cluster (7 most representative + 3 random).
            - iters (int): Number of iterations to convergence for the best run.
    """
    # Normalize the embedded vectors
    arr = np.asarray(embed_list, dtype=object)
    if arr.dtype == object or arr.ndim == 1:
        arr = np.array(list(arr), dtype=np.float64)
    else:
        arr = arr.astype(np.float64, copy=False)

    if num_clusters is None:
        num_clusters = estimate_num_clusters(arr)
        print(f"  Estimated number of clusters: {num_clusters}")

    Xn = normalize_rows(arr)

    best_score: float = -np.inf
    best_result: tuple | None = None

    seed_offset = run_num * n_restarts
    for seed in range(seed_offset, seed_offset + n_restarts):
        centroids_idx, centroids = kmeans_plus_plus_init(
            arr, num_clusters, random_state=seed, return_indices=True
        )
        groups = [[] for _ in range(num_clusters)]

        embed_clust, soft_clusters, new_centroids, iters = setup_clusters(
            [centroids], arr, groups, soft_assign=soft_assign, iter=0
        )

        score = _score_clustering(embed_clust, new_centroids, Xn)
        print(
            f"  Restart {seed - seed_offset + 1}/{n_restarts} (seed {seed}) — score: {score:.4f}"
        )

        if score > best_score:
            best_score = score
            best_result = (embed_clust, soft_clusters, new_centroids, iters)

    assert best_result is not None
    embed_clust, soft_clusters, new_centroids, iters = best_result
    print(f"  Best score: {best_score:.4f}")

    representative_samples = return_representative_samples(
        arr, embed_clust, new_centroids
    )

    # Invert soft_clusters (cluster-indexed) to soft_membership (embed-indexed)
    if soft_clusters is not None:
        soft_membership: list[list[int]] | None = [[] for _ in range(len(arr))]
        for cluster_idx, members in enumerate(soft_clusters):
            for embed_idx in members:
                soft_membership[embed_idx].append(cluster_idx)
    else:
        soft_membership = None

    return embed_clust, soft_membership, representative_samples, iters
