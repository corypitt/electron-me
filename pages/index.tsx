// pages/index.tsx
import React from 'react'
import type { NextPage } from 'next'
import Layout from '../components/Layout'
import OpenAIChat from '../components/OpenAIChat'

const Home: NextPage = () => {
  return (
    <Layout>
      <div className="bg-white shadow-md rounded-lg flex-1 flex flex-col">
        <OpenAIChat />
      </div>
    </Layout>
  );
};

export default Home;