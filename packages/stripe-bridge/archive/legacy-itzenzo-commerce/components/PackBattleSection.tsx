import Container from "@/components/layout/Container";
import CurrentPackBattle from "@/components/CurrentPackBattle";
import PullBoxes from "@/components/PullBoxes";
import HomepageBundle from "@/components/HomepageBundle";
import type {
  CurrentPackBattle as CurrentPackBattleData,
  HomepageBundle as HomepageBundleData,
  PullBoxes as PullBoxesData,
} from "@/lib/graphql/types";

interface PackBattleSectionProps {
  packBattle: CurrentPackBattleData;
  pullBoxes: PullBoxesData;
  homepageBundle: HomepageBundleData;
  discordUrl: string;
}

export default function PackBattleSection({
  packBattle,
  pullBoxes,
  homepageBundle,
  discordUrl,
}: PackBattleSectionProps) {
  return (
    <Container as="section" className="py-[clamp(2rem,5vw,4rem)]">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CurrentPackBattle data={packBattle} discordUrl={discordUrl} />
        <div className="flex flex-col gap-6">
          <PullBoxes data={pullBoxes} />
          <HomepageBundle data={homepageBundle} />
        </div>
      </div>
    </Container>
  );
}
