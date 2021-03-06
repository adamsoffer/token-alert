import Layout from "../components/Layout";
import Header from "../components/Header";
import Masthead from "../components/Masthead";
import CardPanel from "../components/CardPanel";
import NextSeo from "next-seo";
import seoDefaultConfig from "../next-seo.config";
import * as Scroll from "react-scroll";

let Element = Scroll.Element;

const Page: any = () => {
  return (
    <Layout>
      <NextSeo config={{ ...seoDefaultConfig }} />
      <Header />
      <Masthead />
      <Element name="products">
        <CardPanel />
      </Element>
    </Layout>
  );
};

export default Page;
