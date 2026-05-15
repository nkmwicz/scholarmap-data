import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from api.db import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    author: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    year: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    volume_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_type: Mapped[str] = mapped_column(
        String, nullable=False, default="letters"
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    gallica_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    gallica_offset: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    pages: Mapped[list["OcrPage"]] = relationship(
        "OcrPage", back_populates="book", cascade="all, delete-orphan"
    )
    excluded_pages: Mapped[list["ExcludedPage"]] = relationship(
        "ExcludedPage", back_populates="book", cascade="all, delete-orphan"
    )
    boundaries: Mapped[list["SegmentBoundary"]] = relationship(
        "SegmentBoundary", back_populates="book", cascade="all, delete-orphan"
    )
    segments: Mapped[list["Segment"]] = relationship(
        "Segment", back_populates="book", cascade="all, delete-orphan"
    )
    clusters: Mapped[list["Cluster"]] = relationship(
        "Cluster", back_populates="book", cascade="all, delete-orphan"
    )


class OcrPage(Base):
    __tablename__ = "ocr_pages"
    __table_args__ = (UniqueConstraint("book_id", "page_index"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE")
    )
    page_index: Mapped[int] = mapped_column(Integer, nullable=False)
    markdown: Mapped[str] = mapped_column(Text, nullable=False)
    lines: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)

    book: Mapped["Book"] = relationship("Book", back_populates="pages")


class ExcludedPage(Base):
    __tablename__ = "excluded_pages"

    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), primary_key=True
    )
    page_index: Mapped[int] = mapped_column(Integer, primary_key=True)

    book: Mapped["Book"] = relationship("Book", back_populates="excluded_pages")


class SegmentBoundary(Base):
    __tablename__ = "segment_boundaries"
    __table_args__ = (UniqueConstraint("book_id", "boundary_index"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE")
    )
    boundary_index: Mapped[int] = mapped_column(Integer, nullable=False)
    page_index: Mapped[int] = mapped_column(Integer, nullable=False)
    line_index: Mapped[int] = mapped_column(Integer, nullable=False)
    segment_title: Mapped[str] = mapped_column(Text, nullable=False, default="")

    book: Mapped["Book"] = relationship("Book", back_populates="boundaries")


class Segment(Base):
    __tablename__ = "segments"
    __table_args__ = (UniqueConstraint("book_id", "segment_index"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE")
    )
    segment_index: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    markdown: Mapped[str] = mapped_column(Text, nullable=False)
    page_range: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), nullable=False, default=list
    )
    document_type: Mapped[str] = mapped_column(String, nullable=False)

    book: Mapped["Book"] = relationship("Book", back_populates="segments")
    chunks: Mapped[list["SegmentChunk"]] = relationship(
        "SegmentChunk", back_populates="segment", cascade="all, delete-orphan"
    )


class SegmentChunk(Base):
    __tablename__ = "segment_chunks"
    __table_args__ = (UniqueConstraint("segment_id", "chunk_index"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    segment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("segments.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    word_length: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(384), nullable=True)

    segment: Mapped["Segment"] = relationship("Segment", back_populates="chunks")
    memberships: Mapped[list["ClusterMembership"]] = relationship(
        "ClusterMembership", back_populates="chunk", cascade="all, delete-orphan"
    )


class Cluster(Base):
    __tablename__ = "clusters"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE")
    )
    cluster_index: Mapped[int] = mapped_column(Integer, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    is_subcluster: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    parent_cluster_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clusters.id", ondelete="SET NULL"),
        nullable=True,
    )

    book: Mapped["Book"] = relationship("Book", back_populates="clusters")
    memberships: Mapped[list["ClusterMembership"]] = relationship(
        "ClusterMembership", back_populates="cluster", cascade="all, delete-orphan"
    )


class ClusterMembership(Base):
    __tablename__ = "cluster_memberships"

    chunk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("segment_chunks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    cluster_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clusters.id", ondelete="CASCADE"),
        primary_key=True,
    )
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_representative: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    chunk: Mapped["SegmentChunk"] = relationship(
        "SegmentChunk", back_populates="memberships"
    )
    cluster: Mapped["Cluster"] = relationship("Cluster", back_populates="memberships")
