import { CharacterSheetApp } from "@/components/sheet/CharacterSheetApp";

export const dynamic = "force-dynamic";

export default async function CharacterPage({ params }: PageProps<"/kampanja/[campaignId]/lik/[characterId]">) {
  const { campaignId, characterId } = await params;
  return <CharacterSheetApp campaignId={campaignId} characterId={characterId} />;
}
