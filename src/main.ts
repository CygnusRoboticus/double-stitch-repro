import { delegateToSchema } from "@graphql-tools/delegate";
import { addMocksToSchema } from "@graphql-tools/mock";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { stitchSchemas } from "@graphql-tools/stitch";
import { FilterRootFields, RenameTypes } from "@graphql-tools/wrap";
import {
  ApolloServerPluginLandingPageGraphQLPlayground,
  ApolloServerPluginLandingPageGraphQLPlaygroundOptions,
} from "apollo-server-core";
import { ApolloServer, ApolloServerExpressConfig } from "apollo-server-express";
import express from "express";
import { GraphQLSchema } from "graphql";

function getDocumentationSchema() {
  const postSchema = makeExecutableSchema({
    typeDefs: /* GraphQL */ `
      type Post {
        id: ID!
        text: String
        userId: ID!
      }
      type Query {
        postById(id: ID!): Post
        postsByUserId(userId: ID!): [Post]!
      }
    `,
  });

  const postsSubschema = {
    schema: addMocksToSchema({ schema: postSchema }),
    transforms: [
      // remove the "postsByUserId" root field
      new FilterRootFields((op, field) => field !== "postsByUserId"),
      // prefix all type names with "Post_"
      new RenameTypes((name) => `Post_${name}`),
    ],
  };

  const userSchema = makeExecutableSchema({
    typeDefs: /* GraphQL */ `
      type User {
        id: ID!
        email: String
      }

      type Query {
        userById(id: ID!): User
      }
    `,
  });

  const usersSubschema = {
    schema: addMocksToSchema({ schema: userSchema }),
  };

  const stitchedSchema = stitchSchemas({
    subschemas: [postsSubschema, usersSubschema],
    typeDefs: /* GraphQL */ `
      extend type User {
        posts: [Post_Post!]!
      }
      extend type Post_Post {
        user: User!
      }
    `,
    resolvers: {
      User: {
        posts: {
          selectionSet: `{ id }`,
          resolve(user, args, context, info) {
            return delegateToSchema({
              schema: postsSubschema,
              operation: "query",
              fieldName: "postsByUserId",
              args: { userId: user.id },
              context,
              info,
            });
          },
        },
      },
      Post_Post: {
        user: {
          selectionSet: `{ userId }`,
          resolve(post, args, context, info) {
            return delegateToSchema({
              schema: usersSubschema,
              operation: "query",
              fieldName: "userById",
              args: { id: post.userId },
              context,
              info,
            });
          },
        },
      },
    },
  });

  return stitchedSchema;
}

async function getApolloServer(
  schema: GraphQLSchema,
  playgroundOpts?: ApolloServerPluginLandingPageGraphQLPlaygroundOptions
) {
  const options: ApolloServerExpressConfig = {
    schema,
    introspection: true,
    plugins: [ApolloServerPluginLandingPageGraphQLPlayground(playgroundOpts)],
  };
  const server = new ApolloServer(options);
  await server.start();
  return server;
}

async function initApp() {
  const app = express();
  app.get("/", (req, res) => res.redirect("/graphql"));

  app.use(
    (
      await getApolloServer(getDocumentationSchema(), {
        tabs: [
          {
            endpoint: "http://localhost:8000/graphql",
            query: `query {
  userById(id: 1) {
    posts {
      # should be added by selectionSet
      # userId
      user {
        id
      }
    }
  }
}
        `,
          },
        ],
      })
    ).getMiddleware({ path: "/graphql" })
  );

  return app;
}

(async function startServer() {
  const server = await initApp();
  return server.listen(8000);
})().catch(console.error);
