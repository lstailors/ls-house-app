import { describe, expect, test } from "bun:test";
import {
  indexFilesByName,
  indexYzstkItems,
  photoProxyUrl,
  resolvePiecePhoto,
  safeErpFilePath,
  serializeStockPiece,
  yzstkCode,
} from "./fabric-stock";

describe("yzstkCode", () => {
  test("pads piece numbers", () => {
    expect(yzstkCode(1)).toBe("YZSTK-001");
    expect(yzstkCode(81)).toBe("YZSTK-081");
  });

  test("rejects junk", () => {
    expect(yzstkCode(null)).toBeNull();
    expect(yzstkCode(0)).toBeNull();
  });
});

describe("safeErpFilePath", () => {
  test("keeps public and private file paths", () => {
    expect(safeErpFilePath("/files/YZSTK-081.jpg")).toBe("/files/YZSTK-081.jpg");
    expect(safeErpFilePath("/private/files/LST STOCK FABRIC AND LINING (81).jpg")).toBe(
      "/private/files/LST STOCK FABRIC AND LINING (81).jpg",
    );
  });

  test("strips origin and blocks traversal", () => {
    expect(safeErpFilePath("https://erp.lstailors.com/files/YZSTK-081.jpg")).toBe("/files/YZSTK-081.jpg");
    expect(safeErpFilePath("/files/../private/files/secret.jpg")).toBeNull();
    expect(safeErpFilePath("/tmp/photo.jpg")).toBeNull();
  });
});

describe("resolvePiecePhoto", () => {
  const files = indexFilesByName([
    { file_name: "LST STOCK FABRIC AND LINING (1).jpg", file_url: "/private/files/LST STOCK FABRIC AND LINING (1).jpg" },
    { file_name: "YZSTK-002.jpg", file_url: "/files/YZSTK-002.jpg" },
    { file_name: "YZSTK-003-photo.jpg", file_url: "/files/YZSTK-003-photo.jpg" },
    { file_name: "YZSTK-081.jpg", file_url: "/files/YZSTK-081.jpg" },
  ]);
  const items = indexYzstkItems([
    { name: "YZSTK-004", image: "/files/YZSTK-004.jpg" },
  ]);

  test("uses the piece photo field first", () => {
    expect(
      resolvePiecePhoto(
        { photo: "/files/YZSTK-081.jpg", photo_url: null, filename: "LST STOCK FABRIC AND LINING (81).jpg", piece_no: 81 },
        files,
        items,
      ),
    ).toBe("/files/YZSTK-081.jpg");
  });

  test("falls back to the original LST filename", () => {
    expect(
      resolvePiecePhoto(
        { photo: null, photo_url: null, filename: "LST STOCK FABRIC AND LINING (1).jpg", piece_no: 1 },
        files,
        items,
      ),
    ).toBe("/private/files/LST STOCK FABRIC AND LINING (1).jpg");
  });

  test("falls back to YZSTK-NNN.jpg", () => {
    expect(
      resolvePiecePhoto({ photo: null, photo_url: null, filename: null, piece_no: 2 }, files, items),
    ).toBe("/files/YZSTK-002.jpg");
  });

  test("falls back to a YZSTK prefix file", () => {
    expect(
      resolvePiecePhoto({ photo: null, photo_url: null, filename: null, piece_no: 3 }, files, items),
    ).toBe("/files/YZSTK-003-photo.jpg");
  });

  test("falls back to the YZSTK Item image", () => {
    expect(
      resolvePiecePhoto({ photo: null, photo_url: null, filename: null, piece_no: 4 }, files, items),
    ).toBe("/files/YZSTK-004.jpg");
  });
});

describe("serializeStockPiece", () => {
  test("returns a proxied photo URL the gallery can fetch", () => {
    const item = serializeStockPiece(
      {
        name: "FSP-00934",
        title: "tan/brown glen check tweed jacketing",
        piece_no: 81,
        photo: "/files/YZSTK-081.jpg",
        status: "Available",
        kind: "fabric",
        source: "LST",
        length_yds: 2.5,
      },
      new Map(),
      new Map(),
    );
    expect(item.photoUrl).toBe(photoProxyUrl("/files/YZSTK-081.jpg"));
    expect(item.photoUrl).toContain("/api/files/erp?path=");
    expect(item.pieceNo).toBe(81);
  });
});
