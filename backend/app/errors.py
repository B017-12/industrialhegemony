from __future__ import annotations


class UnknownAssetError(LookupError):
    def __init__(self, asset_id: str) -> None:
        super().__init__(f"Unknown asset_id {asset_id}")
        self.asset_id = asset_id


class MissingArtifactError(FileNotFoundError):
    """A pipeline output (scene_objects.json, nav.json, ...) has not been generated yet."""
